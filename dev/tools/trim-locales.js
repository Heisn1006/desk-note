'use strict';

/* ------------------------------------------------------------------
   裁掉无用的 Chromium 语言包（locales/*.pak）
   - Electron 默认带 50 多个语言包，本项目只有三种界面语言
   - 保留 en-US / zh-CN / zh-TW；其余删除
   - 找不到 locales 目录时直接报错，避免静默跳过
   用法：node tools/trim-locales.js [dist/DeskNote/locales]
   ------------------------------------------------------------------ */

const fs = require('node:fs');
const path = require('node:path');

const KEEP = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak']);
const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'dist', 'DeskNote', 'locales'));

if (!fs.existsSync(dir)) {
  console.error(`找不到语言包目录: ${dir}`);
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pak'));
const missing = [...KEEP].filter((f) => !files.includes(f));
if (missing.length) {
  console.error(`缺少必需的语言包: ${missing.join(', ')}（不敢删，先停下）`);
  process.exit(1);
}

let removed = 0;
let bytes = 0;
for (const f of files) {
  if (KEEP.has(f)) continue;
  const p = path.join(dir, f);
  bytes += fs.statSync(p).size;
  fs.unlinkSync(p);
  removed++;
}

const rest = fs.readdirSync(dir).filter((f) => f.endsWith('.pak')).sort();
console.log(`语言包: 删除 ${removed} 个（${(bytes / 1048576).toFixed(1)}MB），保留 ${rest.join(', ')}`);
