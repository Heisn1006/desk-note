'use strict';

/* 把当前版本的可移植包发布到安装包存档目录：
   dist/DeskNote-v<ver>-portable.zip -> D:\DeskNote安装包\DeskNote-<ver>.setup.zip
   用法：node tools/publish-setup.js   （或双击 发布安装包.cmd） */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const version = require(path.join(ROOT, 'package.json')).version;
const src = path.join(ROOT, 'dist', `DeskNote-v${version}-portable.zip`);
const destDir = process.env.DESKNOTE_SETUP_DIR || 'D:\\DeskNote安装包';
const dest = path.join(destDir, `DeskNote-${version}.setup.zip`);

if (!fs.existsSync(src)) {
  console.error(`找不到打包产物: ${src}`);
  console.error('先按交接文档 §7 打包，再发布。');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);

const mb = (fs.statSync(dest).size / 1048576).toFixed(0);
console.log(`✓ DeskNote-${version}.setup.zip (${mb}MB)`);
console.log(`  -> ${dest}`);
