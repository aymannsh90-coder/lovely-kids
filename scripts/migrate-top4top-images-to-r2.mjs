#!/usr/bin/env node
// Lovely Kids one-time Top4top -> R2 migration (no database modifications).
// --check checks sources. --apply uploads/byte-verifies and generates reviewable SQL.
// Uses Wrangler authentication already configured in Replit. No secret is printed.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BUCKET = 'lovely-kids-media-r2';
const BASE = 'https://media.lovelykids.net/media/r2/';
const OUT = path.join(tmpdir(), 'lovely-kids-top4top-r2-migration');
const MAX_BYTES = 5 * 1024 * 1024;
// Snapshot from 2026-11-12: 10 products and 17 external images.
// Product 242 is excluded because it already points to R2.
const PRODUCTS = [
  { id: 230, name: 'طقم بيبي بناتي 3 قطع شتوي من عمر 3 - 9 شهور', urls: ['https://l.top4top.io/p_389769s6n0.png'] },
  { id: 231, name: 'افرهول بيبي ولادي بناتي مبطن فرو', urls: ['https://e.top4top.io/p_3898ttaf81.jpg', 'https://k.top4top.io/p_3898xyrva1.jpg', 'https://l.top4top.io/p_38981hdub2.jpg'] },
  { id: 232, name: 'طقم ولادي 3 قطع من عمر 6-9 سنوات', urls: ['https://h.top4top.io/p_3898vqzzf5.png', 'https://d.top4top.io/p_3898h0roa1.png', 'https://e.top4top.io/p_38980z1lh2.png'] },
  { id: 233, name: 'افرهول بيبي شتوي مخمل مولود جديد', urls: ['https://j.top4top.io/p_3898dvgd71.png'] },
  { id: 234, name: 'افرهول بيبي شتوي مخمل مع طاقيه من عمر 0-9 شهور', urls: ['https://f.top4top.io/p_389821t3z1.png', 'https://i.top4top.io/p_3898i33wy1.png', 'https://j.top4top.io/p_389808kb62.png'] },
  { id: 235, name: 'بجامة بيبي لولو كاتي 0-9 شهور', urls: ['https://d.top4top.io/p_3898fwmw61.png'] },
  { id: 237, name: 'طقم بيبي 3 قطع مولود جديد', urls: ['https://e.top4top.io/p_38981cgbl1.jpg', 'https://j.top4top.io/p_3898kxbu61.png'] },
  { id: 238, name: 'طقم بيبي بناتي 3 قطع مولود جديد', urls: ['https://g.top4top.io/p_3899b2p332.png'] },
  { id: 239, name: 'بنطلون بيبي برجل', urls: ['https://l.top4top.io/p_3899rx3mi0.png'] },
  { id: 241, name: 'تبان بيبي نص جولف', urls: ['https://b.top4top.io/p_3899crbyn1.png'] },
];
const allUrls = [...new Set(PRODUCTS.flatMap(p => p.urls))];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = s => "'" + String(s).replaceAll("'", "''") + "'";
const nap = ms => new Promise(resolve => setTimeout(resolve, ms));

function checkManifest() {
  if (PRODUCTS.length !== 10 || allUrls.length !== 17 || PRODUCTS.some(p => p.id === 242))
    throw new Error('Expected 10 products / 17 URLs excluding #242');
  for (const url of allUrls) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/^[a-z]\.top4top\.io$/.test(u.hostname) || !/^\/p_[a-z0-9]+\.(png|jpg|jpeg|webp)$/.test(u.pathname))
      throw new Error('Unsafe source: ' + url);
  }
}
function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: 'image/png', ext: 'png' };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
async function fetchBytes(url, requireSource = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'image/png,image/jpeg,image/webp' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (requireSource) {
      const final = new URL(r.url);
      if (final.protocol !== 'https:' || !/^[a-z]\.top4top\.io$/.test(final.hostname))
        throw new Error('Unexpected redirect host');
    }
    if (Number(r.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Larger than 5MB');
    const reader = r.body?.getReader();
    if (!reader) throw new Error('Empty response');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new Error('Larger than 5MB'); }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length) throw new Error('Empty image');
    return bytes;
  } finally { clearTimeout(timeout); }
}
async function download(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const bytes = await fetchBytes(url, true);
      const type = imageType(bytes);
      if (!type) throw new Error('Not a PNG/JPEG/WebP; possibly HTML error page');
      return { bytes, ...type };
    } catch (e) {
      last = e;
      if (attempt < 3) await nap(1100 * attempt);
    }
  }
  throw last;
}
function uploadR2(localFile, filename, mime) {
  const custom = process.env.WRANGLER_COMMAND;
  const bin = custom || 'npx';
  const args = [...(custom ? [] : ['--yes', 'wrangler@4.152.0']),
    'r2', 'object', 'put', BUCKET + '/' + filename, '--remote',
    '--file=' + localFile, '--content-type=' + mime,
    '--cache-control=public, max-age=31536000, immutable', '--force'];
  const res = spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  if (res.error || res.status !== 0)
    throw new Error('Wrangler failed: ' + (res.stderr || res.stdout || res.error?.message || '').slice(-1100));
}
async function verifyR2(url, expectedHash, expectedSize) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const bytes = await fetchBytes(url);
      if (bytes.length !== expectedSize || hash(bytes) !== expectedHash)
        throw new Error('Public R2 file did not match source bytes');
      return;
    } catch (e) {
      last = e;
      if (attempt < 3) await nap(1500 * attempt);
    }
  }
  throw last;
}
function replacements(column, entries, jsonb) {
  let expr = jsonb ? "COALESCE(" + column + ", '[]'::jsonb)::text" : column;
  for (const [oldUrl, newUrl] of entries)
    expr = 'replace(' + expr + ', ' + quote(oldUrl) + ', ' + quote(newUrl) + ')';
  return jsonb ? '(' + expr + ')::jsonb' : expr;
}
function renderSql(ready) {
  const lines = [
    '-- AUTO-GENERATED AFTER R2 BYTE VERIFICATION. REVIEW BEFORE EXECUTION.',
    '-- Changes only exact URL matches in image, images and color_variants.',
    '-- Product stocks, prices and other data are untouched.',
    'BEGIN;'
  ];
  for (const product of ready) {
    const entries = product.urls.map(url => [url, product.mappings[url]]);
    lines.push('-- Product #' + product.id + ': ' + product.name);
    lines.push('UPDATE public.products SET');
    lines.push('  image = ' + replacements('image', entries, false) + ',');
    lines.push('  images = ' + replacements('images', entries, true) + ',');
    lines.push('  color_variants = ' + replacements('color_variants', entries, true));
    lines.push('WHERE id = ' + product.id + ' AND deleted_at IS NULL');
    lines.push("  AND (COALESCE(image,'') LIKE '%top4top.io/%' OR COALESCE(images::text,'') LIKE '%top4top.io/%' OR COALESCE(color_variants::text,'') LIKE '%top4top.io/%');");
  }
  lines.push('COMMIT;');
  return lines.join('\n') + '\n';
}
async function main() {
  checkManifest();
  const mode = process.argv[2] || '--check';
  if (!['--check', '--apply', '--self-test'].includes(mode) || process.argv.length > 3) {
    console.error('Usage: node scripts/migrate-top4top-images-to-r2.mjs [--check|--apply|--self-test]');
    process.exitCode = 2;
    return;
  }
  if (mode === '--self-test') {
    const p = PRODUCTS[0];
    const sql = renderSql([{ ...p, mappings: { [p.urls[0]]: BASE + 'dummy.png' } }]);
    if (!sql.includes('UPDATE public.products SET') || !sql.includes('color_variants') || sql.includes('DELETE FROM'))
      throw new Error('SQL self-test failed');
    console.log('SELF_TEST_OK: 10 products, 17 URLs; SQL only updates images');
    return;
  }
  await mkdir(OUT, { recursive: true });
  const runDir = await mkdtemp(path.join(OUT, 'run-'));
  const results = {};
  console.log('Mode: ' + mode + '. Checking ' + allUrls.length + ' URLs in ' + PRODUCTS.length + ' products.');
  for (let i = 0; i < allUrls.length; i++) {
    const oldUrl = allUrls[i];
    try {
      const source = await download(oldUrl);
      const digest = hash(source.bytes);
      const filename = 'legacy-top4top-' + digest.slice(0,32) + '.' + source.ext;
      const newUrl = BASE + filename;
      if (mode === '--apply') {
        const file = path.join(runDir, filename);
        await writeFile(file, source.bytes);
        uploadR2(file, filename, source.mime);
        await verifyR2(newUrl, digest, source.bytes.length);
        results[oldUrl] = { status: 'verified', newUrl, sha256: digest, bytes: source.bytes.length };
        console.log('[' + (i+1) + '/17] VERIFIED ' + newUrl);
      } else {
        results[oldUrl] = { status: 'available', sha256: digest, bytes: source.bytes.length };
        console.log('[' + (i+1) + '/17] AVAILABLE ' + oldUrl);
      }
    } catch (e) {
      results[oldUrl] = { status: 'failed', error: String(e?.message || e).slice(0,600) };
      console.error('[' + (i+1) + '/17] FAILED ' + oldUrl + ': ' + results[oldUrl].error);
    }
  }
  const ready = mode === '--apply' ? PRODUCTS.filter(p => p.urls.every(url => results[url]?.status === 'verified')).map(p => ({
    ...p, mappings: Object.fromEntries(p.urls.map(url => [url, results[url].newUrl]))
  })) : [];
  const blocked = PRODUCTS.filter(p => p.urls.some(url => results[url]?.status === 'failed'));
  const report = {
    created_at: new Date().toISOString(), mode, image_count: allUrls.length,
    verified_image_count: Object.values(results).filter(x => x.status === 'verified').length,
    ready_product_ids: ready.map(p => p.id), blocked_product_ids: blocked.map(p => p.id),
    results, ready_products: ready
  };
  await writeFile(path.join(OUT, 'migration-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (mode === '--apply') await writeFile(path.join(OUT, 'apply-after-review.sql'), renderSql(ready));
  console.log('RESULT: verified ' + report.verified_image_count + '/17; ready products ' + ready.length + '/10; blocked ' + blocked.length);
  console.log('REPORT=' + path.join(OUT, 'migration-report.json'));
  if (mode === '--apply') console.log('SQL_FOR_REVIEW=' + path.join(OUT, 'apply-after-review.sql'));
  console.log('DATABASE UNCHANGED. Share the report for a guarded database update.');
  if (blocked.length) process.exitCode = 1;
}
main().catch(e => { console.error('FATAL:', e?.message || e); process.exitCode = 1; });
