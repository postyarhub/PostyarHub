const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'frontend/src/wordpressTools.ts');
let s = fs.readFileSync(file, 'utf8');

const oldLine = "root.innerHTML = '<div class=\"wp-template-preview\">در حال آماده‌سازی قالب‌ها و کمپین‌ها…</div>';";
const newLine = "root.innerHTML = '<div class=\"wp-tools-loading-shell\"><div class=\"wp-tools-loading-shell__title\">قالب‌ها و کمپین‌ها</div><div class=\"wp-tools-loading-shell__bars\"><span></span><span></span><span></span></div><div class=\"wp-tools-loading-shell__meta\">در حال بارگذاری اطلاعات</div></div>';";

if (s.includes(oldLine)) {
  s = s.replace(oldLine, newLine);
} else if (!s.includes('wp-tools-loading-shell')) {
  throw new Error('Content-tools loading checkpoint: expected loading line not found. File was not changed.');
}

const oldAwait = 'const state = await loadState();';
const newAwait = "const state = await Promise.race([loadState(), new Promise<Awaited<ReturnType<typeof loadState>>>((_, reject) => window.setTimeout(() => reject(new Error('CONTENT_TOOLS_TIMEOUT')), 12000))]);";
if (s.includes(oldAwait)) s = s.replace(oldAwait, newAwait);

if (s.includes('campaignPickerType')) {
  throw new Error('Content-tools checkpoint: forbidden global campaignPickerType detected. File was not written.');
}

fs.writeFileSync(file, s);
console.log('CONTENT_TOOLS_LOADING_CHECKPOINT_PASS');
