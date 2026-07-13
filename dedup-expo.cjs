#!/usr/bin/env node
/**
 * dedup-expo.cjs  –  Post-install Expo deduplication for pnpm hoisted monorepo
 *
 * WHY THIS EXISTS
 * ───────────────
 * pnpm with node-linker=hoisted installs direct workspace-package dependencies
 * in TWO places simultaneously:
 *   (A) /workspace/node_modules/<pkg>          ← flat hoisted copy
 *   (B) /workspace/artifacts/lovely-kids/node_modules/<pkg>  ← local copy
 * expo-doctor finds both and reports "duplicate native module dependencies".
 *
 * Additionally, pnpm creates peer-dependency variants under the virtual store:
 *   (C) /workspace/node_modules/.pnpm/react@X.Y.Z/node_modules/react
 * When the hoisted copy (A) was created in a previous install run and the
 * virtual-store copy (C) was created in a later --no-frozen-lockfile run,
 * the two physical files have different inodes even though they are the same
 * package version. expo-doctor then reports "linked to a different installation".
 *
 * WHAT THIS SCRIPT DOES
 * ─────────────────────
 * Phase 1 – Allowlist dedup (lovely-kids local → root hoisted)
 *   Removes a FIXED allowlist of native Expo packages from
 *   artifacts/lovely-kids/node_modules when the exact same version already
 *   exists in the root node_modules.  Metro still resolves them via the
 *   nodeModulesPaths in metro.config.js.
 *   react, react-dom, Clerk, and ALL other packages are never touched here.
 *
 * Phase 2 – Hoisted vs virtual-store inode alignment (react / react-dom only)
 *   Converts root node_modules/react (and react-dom) from a physical copy to a
 *   symlink that points at the identical package already present in pnpm's
 *   virtual store (.pnpm/react@VERSION/node_modules/react).  This does NOT
 *   delete react; it remains fully accessible at node_modules/react, but now
 *   via a symlink so that all paths share the same underlying inode.
 *   Skipped if the package is already a symlink or the inodes already match.
 *
 * Phase 3 – babel-preset-expo visibility symlinks
 *   babel-preset-expo lives in ROOT/node_modules and uses hasModule() (i.e.
 *   require.resolve) to detect optional integrations such as expo-router,
 *   react-native-worklets, and react-native-reanimated. With pnpm hoisted,
 *   those packages end up ONLY in artifacts/lovely-kids/node_modules (not in
 *   ROOT), so hasModule() returns false and the corresponding babel plugins are
 *   never loaded — critically, expoRouterBabelPlugin is skipped, leaving
 *   process.env.EXPO_ROUTER_APP_ROOT un-inlined, which makes
 *   collect-dependencies.js throw "First argument of require.context should be
 *   a string" when bundling for Android.
 *   Fix: create symlinks at ROOT/node_modules/<pkg> pointing into
 *   artifacts/lovely-kids/node_modules/<pkg> so hasModule() succeeds.
 */

'use strict';

const {
  existsSync, rmSync, readFileSync, statSync,
  symlinkSync, lstatSync, readdirSync,
} = require('fs');
const { join } = require('path');
const Module = require('module');

// ── Allowlist: exactly the native Expo packages expo-doctor has historically
//   flagged for this workspace. Do NOT add react, react-dom, Clerk, or any
//   other non-native package here.
const ALLOWLIST = [
  'expo',
  'expo-asset',
  'expo-constants',
  'expo-font',
  'expo-file-system',
  'expo-modules-core',
  '@expo/vector-icons',
  // react-native appended conditionally below only if truly duplicated
];

// ── Paths ────────────────────────────────────────────────────────────────────
const WORKSPACE_ROOT = __dirname;
const LOCAL_NM       = join(WORKSPACE_ROOT, 'artifacts', 'lovely-kids', 'node_modules');
const ROOT_NM        = join(WORKSPACE_ROOT, 'node_modules');
const PNPM_DIR       = join(ROOT_NM, '.pnpm');

// ── Helpers ──────────────────────────────────────────────────────────────────
function pkgVersion(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  } catch { return null; }
}

function isSymlink(p) {
  try { return lstatSync(p).isSymbolicLink(); }
  catch { return false; }
}

function inodeOf(p) {
  try { return statSync(p).ino; }
  catch { return null; }
}

/** Check that pkg is resolvable from ROOT_NM (i.e. root copy will serve it). */
function resolvableFromRoot(pkgName) {
  try {
    const req = Module.createRequire(join(ROOT_NM, '_probe_.js'));
    const resolved = req.resolve(`${pkgName}/package.json`);
    return resolved.startsWith(ROOT_NM) || resolved.startsWith(WORKSPACE_ROOT);
  } catch { return false; }
}

// ── Conditionally add react-native to allowlist if truly duplicated ──────────
{
  const rnLocal = join(LOCAL_NM, 'react-native');
  const rnRoot  = join(ROOT_NM,  'react-native');
  if (existsSync(rnLocal) && existsSync(rnRoot)) {
    const lv = pkgVersion(rnLocal);
    const rv = pkgVersion(rnRoot);
    if (lv && rv && lv === rv) ALLOWLIST.push('react-native');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 1 – Allowlist dedup: remove local copies from lovely-kids/node_modules
// ════════════════════════════════════════════════════════════════════════════
console.log('[dedup-expo] Phase 1: allowlist dedup (lovely-kids local → root)');

let removed1 = 0, skipped1 = 0;

if (!existsSync(LOCAL_NM)) {
  console.log('[dedup-expo]   lovely-kids/node_modules not found — skipping Phase 1.');
} else {
  for (const pkgName of ALLOWLIST) {
    const local = join(LOCAL_NM, pkgName);
    const root  = join(ROOT_NM, pkgName);

    if (!existsSync(local)) {
      console.log(`[dedup-expo]   skip  ${pkgName} — not in local node_modules`);
      skipped1++; continue;
    }
    if (!existsSync(root)) {
      console.log(`[dedup-expo]   KEEP  ${pkgName} — not found in root (cannot remove local copy)`);
      skipped1++; continue;
    }
    const lv = pkgVersion(local), rv = pkgVersion(root);
    if (!lv || !rv || lv !== rv) {
      console.log(`[dedup-expo]   KEEP  ${pkgName} — version mismatch (local=${lv} root=${rv})`);
      skipped1++; continue;
    }
    if (!resolvableFromRoot(pkgName)) {
      console.log(`[dedup-expo]   KEEP  ${pkgName} — root copy not resolvable`);
      skipped1++; continue;
    }

    rmSync(local, { recursive: true, force: true });
    removed1++;
    console.log(`[dedup-expo]   removed duplicate ${pkgName}@${lv}`);
  }
}

console.log(`[dedup-expo] Phase 1 done — removed ${removed1}, skipped ${skipped1}.`);

// ════════════════════════════════════════════════════════════════════════════
// Phase 2 – Inode alignment: hoisted react/react-dom ↔ pnpm virtual store
//
// With node-linker=hoisted, pnpm may produce two physical copies of react:
//   root node_modules/react            ← physical (inode A)
//   .pnpm/react@VERSION/node_modules/react ← physical (inode B, from a later
//                                             --no-frozen-lockfile run)
// expo-doctor sees A ≠ B and reports "linked to a different installation".
//
// Fix: convert the hoisted copy to a symlink that points to the virtual store
// entry.  The package remains accessible at node_modules/react (via symlink).
// We never touch react inside lovely-kids/node_modules or inside any .pnpm
// peer-dep variant — only the top-level hoisted copy is touched.
// ════════════════════════════════════════════════════════════════════════════
console.log('[dedup-expo] Phase 2: hoisted vs virtual-store inode alignment (react / react-dom)');

const INODE_ALIGN = ['react', 'react-dom'];
let aligned = 0;

if (!existsSync(PNPM_DIR)) {
  console.log('[dedup-expo]   .pnpm virtual store not found — skipping Phase 2.');
} else {
  for (const pkg of INODE_ALIGN) {
    const hoisted = join(ROOT_NM, pkg);

    // Skip if package not installed at root level
    if (!existsSync(hoisted)) {
      console.log(`[dedup-expo]   skip  ${pkg} — not in root node_modules`);
      continue;
    }

    // Already a symlink — inodes will naturally match via the link chain
    if (isSymlink(hoisted)) {
      console.log(`[dedup-expo]   skip  ${pkg} — already a symlink`);
      continue;
    }

    const hoistedVersion = pkgVersion(hoisted);
    if (!hoistedVersion) continue;

    // Locate virtual store entry: .pnpm/react@VERSION/node_modules/react
    // pnpm may append a hash suffix; find the first matching entry.
    let vsDir = null;
    const prefix = `${pkg}@${hoistedVersion}`;
    for (const entry of readdirSync(PNPM_DIR)) {
      if (entry === prefix || entry.startsWith(`${prefix}_`) || entry.startsWith(`${prefix}/`)) {
        const candidate = join(PNPM_DIR, entry, 'node_modules', pkg);
        if (existsSync(candidate)) { vsDir = candidate; break; }
      }
    }

    if (!vsDir) {
      console.log(`[dedup-expo]   skip  ${pkg} — .pnpm virtual store entry not found`);
      continue;
    }

    // Already same inode — nothing to do
    const hoistedIno = inodeOf(hoisted);
    const vsIno      = inodeOf(vsDir);
    if (hoistedIno !== null && hoistedIno === vsIno) {
      console.log(`[dedup-expo]   skip  ${pkg}@${hoistedVersion} — inodes already match`);
      continue;
    }

    // Build a relative symlink path from ROOT_NM to vsDir
    // e.g.  node_modules/react  →  .pnpm/react@19.1.0/node_modules/react
    const entry = vsDir.replace(PNPM_DIR + '/', '').replace(PNPM_DIR + '\\', '');
    // entry = "react@19.1.0/node_modules/react"
    const relTarget = join('.pnpm', entry.split('node_modules')[0].replace(/[\\/]$/, ''), 'node_modules', pkg);

    try {
      rmSync(hoisted, { recursive: true, force: true });
      symlinkSync(relTarget, hoisted);
      aligned++;
      console.log(`[dedup-expo]   aligned ${pkg}@${hoistedVersion} → ${relTarget}`);
    } catch (err) {
      console.error(`[dedup-expo]   ERROR aligning ${pkg}: ${err.message}`);
    }
  }
}

console.log(`[dedup-expo] Phase 2 done — aligned ${aligned} package(s).`);

// ════════════════════════════════════════════════════════════════════════════
// Phase 3 – babel-preset-expo visibility symlinks
//
// babel-preset-expo (installed in ROOT/node_modules) calls hasModule(pkg) which
// uses require.resolve() from ROOT context. Packages that are ONLY installed in
// artifacts/lovely-kids/node_modules are invisible to ROOT's require.resolve,
// so the corresponding babel plugins (e.g. expoRouterBabelPlugin) are never
// added. This causes process.env.EXPO_ROUTER_APP_ROOT to remain un-inlined and
// collect-dependencies.js to throw on _ctx.android.js.
//
// We create symlinks at ROOT/node_modules/<pkg> → ../artifacts/lovely-kids/node_modules/<pkg>
// so hasModule() succeeds. pnpm never manages these paths (no root-level dep),
// so the symlinks persist across installs. The postinstall re-creates them on
// every `pnpm install` as a safety net.
// ════════════════════════════════════════════════════════════════════════════
console.log('[dedup-expo] Phase 3: babel-preset-expo visibility symlinks');

const BABEL_PRESET_NEEDS = [
  'expo-router',
  'react-native-reanimated',
  'react-native-worklets',
];

let symlinked3 = 0;

for (const pkg of BABEL_PRESET_NEEDS) {
  const rootTarget   = join(ROOT_NM, pkg);
  const lkSource     = join(LOCAL_NM, pkg);
  const relTarget    = join('..', 'artifacts', 'lovely-kids', 'node_modules', pkg);

  if (!existsSync(lkSource)) {
    console.log(`[dedup-expo]   skip  ${pkg} — not in lovely-kids/node_modules`);
    continue;
  }

  if (existsSync(rootTarget)) {
    if (isSymlink(rootTarget)) {
      console.log(`[dedup-expo]   skip  ${pkg} — symlink already exists in root`);
    } else {
      console.log(`[dedup-expo]   skip  ${pkg} — real directory already in root (pnpm hoisted it)`);
    }
    continue;
  }

  try {
    symlinkSync(relTarget, rootTarget);
    symlinked3++;
    console.log(`[dedup-expo]   symlinked ${pkg} → ${relTarget}`);
  } catch (err) {
    console.error(`[dedup-expo]   ERROR symlinking ${pkg}: ${err.message}`);
  }
}

console.log(`[dedup-expo] Phase 3 done — symlinked ${symlinked3} package(s).`);
console.log('[dedup-expo] All phases complete.');
