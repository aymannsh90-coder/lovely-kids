#!/usr/bin/env node
/**
 * dedup-expo.cjs
 *
 * pnpm with node-linker=hoisted creates physical copies of workspace
 * dependencies in BOTH the root node_modules AND each workspace package's
 * local node_modules.  expo-doctor treats two physical copies of the same
 * version as a "duplicate native module" and fails the 18/18 check.
 *
 * This script runs after `pnpm install` (postinstall) and removes any package
 * from artifacts/lovely-kids/node_modules that already exists at the same
 * version in the root node_modules.  Metro will still find all packages via
 * the nodeModulesPaths config in metro.config.js.
 */

const { existsSync, rmSync, readFileSync } = require('fs');
const { join } = require('path');

const ROOT = __dirname;
const LOCAL_NM = join(ROOT, 'artifacts', 'lovely-kids', 'node_modules');
const ROOT_NM  = join(ROOT, 'node_modules');

if (!existsSync(LOCAL_NM)) {
  console.log('[dedup-expo] lovely-kids/node_modules not found, skipping.');
  process.exit(0);
}

const { readdirSync } = require('fs');

function pkgVersion(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

let removed = 0;
const entries = readdirSync(LOCAL_NM);

for (const entry of entries) {
  // Handle scoped packages like @expo/vector-icons
  if (entry.startsWith('@')) {
    const scopeDir = join(LOCAL_NM, entry);
    let scopeEntries;
    try { scopeEntries = readdirSync(scopeDir); } catch { continue; }
    for (const sub of scopeEntries) {
      const localPkg  = join(scopeDir, sub);
      const rootPkg   = join(ROOT_NM, entry, sub);
      if (!existsSync(rootPkg)) continue;
      const lv = pkgVersion(localPkg);
      const rv = pkgVersion(rootPkg);
      if (lv && rv && lv === rv) {
        rmSync(localPkg, { recursive: true, force: true });
        removed++;
        console.log(`[dedup-expo] removed duplicate ${entry}/${sub}@${lv}`);
      }
    }
    continue;
  }

  const localPkg = join(LOCAL_NM, entry);
  const rootPkg  = join(ROOT_NM, entry);
  if (!existsSync(rootPkg)) continue;
  const lv = pkgVersion(localPkg);
  const rv = pkgVersion(rootPkg);
  if (lv && rv && lv === rv) {
    rmSync(localPkg, { recursive: true, force: true });
    removed++;
    console.log(`[dedup-expo] removed duplicate ${entry}@${lv}`);
  }
}

console.log(`[dedup-expo] done — removed ${removed} duplicate package(s).`);
