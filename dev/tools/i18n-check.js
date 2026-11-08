'use strict';

/* ------------------------------------------------------------------
   i18n 静态检查（不开 Electron，几毫秒跑完）
   1. 三套语言的 key 集合必须完全一致
   2. HTML / app.js / main.js 里引用的 key 必须都存在
   3. 同一 key 在三套语言里的 {占位符} 必须一致
   4. 英文文案里不能残留中文（繁体里不能残留简体高频字）
   5. tr()/t() 的第一个参数必须是字符串字面量（防止把任务标题当 key）——
      这条同时保证「用户自定义标题」永远不会被塞进翻译表
   用法：node tools/i18n-check.js
   ------------------------------------------------------------------ */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const i18n = require(path.join(ROOT, 'renderer', 'i18n.js'));

const problems = [];
const warnings = [];
const fail = (msg) => problems.push(msg);
const warn = (msg) => warnings.push(msg);

const LANGS = i18n.LANGS.map((l) => l.id);
const DICT = i18n.DICT;

/* ---------------- 1. key 集合与占位符 ---------------- */

const isPlural = (k) => k.endsWith('.one');
const base = Object.keys(DICT['zh-CN']).sort();
for (const lang of LANGS.slice(1)) {
  const keys = Object.keys(DICT[lang]).sort();
  const missing = base.filter((k) => !(k in DICT[lang]));
  // .one 是英文单数形态，允许只在 en 出现（t() 找不到时会退回基名）
  const extra = keys.filter((k) => !(k in DICT['zh-CN']) && !isPlural(k));
  if (missing.length) fail(`${lang} 缺少 key: ${missing.join(', ')}`);
  if (extra.length) fail(`${lang} 多出 key: ${extra.join(', ')}`);
}
for (const key of Object.keys(DICT.en)) {
  if (isPlural(key)) {
    const baseKey = key.slice(0, -4);
    if (!(baseKey in DICT.en)) fail(`en 有 ${key} 却没有基名 ${baseKey}`);
  }
}

const placeholders = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');
for (const key of base) {
  const ref = placeholders(DICT['zh-CN'][key]);
  for (const lang of LANGS.slice(1)) {
    if (!(key in DICT[lang])) continue;
    const got = placeholders(DICT[lang][key]);
    if (got !== ref) fail(`占位符不一致 ${lang}/${key}: 期望 [${ref}] 实际 [${got}]`);
  }
}

/* ---------------- 2. 收集引用 ---------------- */

const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const srcs = {
  app: fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8'),
  main: fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8'),
  i18n: fs.readFileSync(path.join(ROOT, 'renderer', 'i18n.js'), 'utf8'),
};
// 插件也会用 t()，一并纳入引用检查
const pluginDir = path.join(ROOT, 'plugins');
if (fs.existsSync(pluginDir)) {
  for (const id of fs.readdirSync(pluginDir)) {
    const file = path.join(pluginDir, id, 'index.js');
    if (fs.existsSync(file)) srcs['plugin:' + id] = fs.readFileSync(file, 'utf8');
  }
}

const htmlKeys = [...html.matchAll(/data-i18n(?:-title|-ph)?="([^"]+)"/g)].map((m) => m[1]);

// tr('k') / i18n.t('k') / i18n.tCount('k') / t('k')
const callRe = /\b(?:tr|t|tCount|i18n\.t|i18n\.tCount)\(\s*(['"])([^'"]*)\1/g;
const jsKeys = [];
const dynamicPrefixes = new Set();
for (const [name, src] of Object.entries(srcs)) {
  for (const m of src.matchAll(callRe)) {
    const key = m[2];
    if (key.endsWith('.')) {
      // 动态拼接，如 t('group.' + key)，由下面的显式清单覆盖
      dynamicPrefixes.add(key);
      continue;
    }
    jsKeys.push({ key, where: name });
  }
}

// 显式枚举的动态 key
const dynamicKeys = [];
for (let d = 0; d <= 6; d++) dynamicKeys.push(`day.${d}`, `day.${d}.tip`);
for (const t of ['paper', 'night', 'mint', 'indigo', 'rose', 'sand', 'graphite', 'sky']) {
  dynamicKeys.push(`theme.${t}`);
}
for (const g of ['over', 'today', 'tomorrow', 'week', 'later', 'done']) dynamicKeys.push(`group.${g}`);

const referenced = new Set([...htmlKeys, ...jsKeys.map((j) => j.key), ...dynamicKeys]);
const known = new Set(base);
for (const key of referenced) {
  if (!known.has(key)) fail(`引用了不存在的 key: ${key}`);
}

// 每条 key 都能在 zh-CN 里取到非空字符串
for (const key of base) {
  if (!String(DICT['zh-CN'][key]).trim()) fail(`zh-CN/${key} 是空字符串`);
}

/* ---------------- 3. 英文不能残留中文 / 繁体不能残留简体 ---------------- */

const HAN = /[\u4e00-\u9fff]/;
// 这些是只出现在简体里的高频字；命中只提示，不判失败（“繁简同形”的字不放进来）
const SIMPLIFIED_ONLY =
  '设语简启闭却图词汇页顶显隐种节过来还这时问题确边让给带点红绿蓝见说话认识别处张开关录像视繁体标签频状态务项择选终';
for (const [key, val] of Object.entries(DICT.en)) {
  if (HAN.test(val)) fail(`en/${key} 残留中文: ${val}`);
}
for (const [key, val] of Object.entries(DICT['zh-TW'])) {
  if (key === 'dialog.images' || key === 'theme.paper') continue; // 逐条人工看过，不在此做字符级猜
  const bad = [...val].filter((ch) => SIMPLIFIED_ONLY.includes(ch));
  if (bad.length) warn(`zh-TW/${key} 可能残留简体字: ${[...new Set(bad)].join('')} | ${val}`);
}

/* ---------------- 4. 不能把变量当 key ---------------- */

const badCall = /\b(?:tr|i18n\.t|i18n\.tCount)\(\s*[^'"\s)]/g;
for (const [name, src] of Object.entries(srcs)) {
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // 包装器自身的定义（const tr = (key, params) => i18n.t(key, params)）不算违规
    if (/const tr\s*=\s*\(/.test(line)) return;
    if (badCall.test(line)) fail(`${name}:${i + 1} tr()/t() 第一个参数不是字符串字面量: ${line.trim()}`);
    badCall.lastIndex = 0;
  });
}

/* ---------------- 5. 死 key（提示，不判失败） ---------------- */

const used = new Set([...referenced].map((k) => k.replace(/\.one$/, '')));
for (const key of base) {
  if (used.has(key)) continue;
  if (key.endsWith('.one')) continue;
  warn(`可能没人用: ${key}`);
}

/* ---------------- 6. 输出 ---------------- */

const twDiff = base.filter((k) => DICT['zh-TW'][k] !== DICT['zh-CN'][k]).length;
console.log(`语言: ${LANGS.join(' / ')}`);
console.log(`key 总数: ${base.length} | HTML 引用 ${htmlKeys.length} | JS 引用 ${new Set(jsKeys.map((j) => j.key)).size} | 动态 ${dynamicKeys.length}`);
console.log(`繁中与简中不同的条目: ${twDiff}/${base.length}`);
if (warnings.length) {
  console.log(`\n提示 ${warnings.length} 条:`);
  for (const w of warnings) console.log('  · ' + w);
}
if (problems.length) {
  console.log(`\n✗ 失败 ${problems.length} 条:`);
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log('\n✓ i18n 静态检查通过');
