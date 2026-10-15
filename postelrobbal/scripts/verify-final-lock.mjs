import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(ROOT, 'docs/locks/POSTYAR-FROZEN-BASELINE-20261002.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const fail = (m) => { console.error(`LOCK_FAIL: ${m}`); process.exitCode = 1; };

for (const [rel, expected] of Object.entries(manifest.protected_sha256 ?? {})) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { fail(`missing ${rel}`); continue; }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expected) fail(`hash drift ${rel}`);
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const assert = (ok, msg) => { if (!ok) fail(msg); };
const passenger = read('public_html/api/.htaccess');
assert(passenger.includes('PassengerAppRoot "/home/postyarh/postelrobbal/api"'), 'PassengerAppRoot drift');
assert(passenger.includes('PassengerBaseURI "/api"'), 'PassengerBaseURI drift');
assert(passenger.includes('PassengerNodejs "/home/postyarh/nodevenv/postelrobbal/api/22/bin/node"'), 'PassengerNodejs drift');
assert(passenger.includes('PassengerStartupFile app.js'), 'PassengerStartupFile drift');
assert(!fs.existsSync(path.join(ROOT, 'config/.env')), 'secret .env must not be part of source bundle');

assert(read('frontend/src/components/AuthModal.tsx').includes('const captchaEnabled = true;'), 'CAPTCHA is not source-locked');
assert(read('frontend/src/components/AuthModal.tsx').includes('referralCode'), 'registration referral field missing in source');
assert(read('frontend/src/pages/dashboard/Settings.tsx').includes('کد معرف شما'), 'account referral field missing');
assert(read('app/src/modules/payments/payment.routes.ts').includes("z.enum(['online', 'card_to_card', 'wallet'])"), 'wallet method missing from payment contract');
assert(read('app/src/modules/payments/payment.service.ts').includes("input.method === 'wallet'"), 'wallet branch missing');
assert(read('app/src/modules/publishing/post.routes.ts').includes('byPlatform'), 'platform-specific button schema missing');
assert(read('app/src/workers/delivery.worker.ts').includes('buttons.byPlatform?.[platform]'), 'platform-specific delivery missing');
for (const tag of ['{title}', '{description}', '{excerpt}', '{content}', '{link}', '{date}', '{author}', '{site_name}', '{post_type}', '{featured_image}', '{event_type}', '{price}', '{regular_price}', '{sale_price}', '{old_price}', '{sku}', '{stock_status}', '{site_url}', '{product_id}', '{discount_percent}', '{meta:field_name}', '{acf:field_name}', '{jet:field_name}']) {
  assert(read('app/src/modules/templates/template.service.ts').includes(`code: '${tag}'`), `template tag missing ${tag}`);
}
const bundle = read('public_html/assets/index-CjIBK3lx-v26.js');
assert(bundle.includes('label:"کد معرف"'), 'compiled registration referral input missing');
assert(bundle.includes('value:n.referralCode'), 'compiled referral state binding missing');
assert(bundle.includes('referralCode:new URLSearchParams'), 'compiled referral prefill missing');
const postBundle = read('public_html/assets/PostNew-CG0Hh2-o-v26.js');
assert(postBundle.includes('byPlatform'), 'compiled platform-button bundle missing');
const subscriptionBundle = read('public_html/assets/Subscription-Mxm8p0tL-v19.js');
assert(subscriptionBundle.includes('wallet'), 'compiled wallet payment flow missing');

// Syntax-check all backend runtime files.
const distRoot = path.join(ROOT, 'app/dist');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const jsFiles = walk(distRoot).filter((f) => f.endsWith('.js'));
for (const file of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) { fail(`JS syntax ${path.relative(ROOT, file)}: ${r.stderr}`); break; }
}
if (process.exitCode) process.exit(process.exitCode);
console.log(`LOCK_PASS: ${Object.keys(manifest.protected_sha256).length} protected files; ${jsFiles.length} backend JS files syntax-checked.`);
