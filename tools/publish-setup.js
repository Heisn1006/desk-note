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

/* 存档目录只留最近 N 个版本（默认：当前 + 上两个），否则会无限长 */
const KEEP = Math.max(1, Number(process.env.DESKNOTE_KEEP || 3));
const re = /^DeskNote-(\d+)\.(\d+)\.(\d+)\.setup\.zip$/i;
const cmpVer = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
};

const packs = fs
  .readdirSync(destDir)
  .map((name) => {
    const m = name.match(re);
    return m ? { name, ver: `${m[1]}.${m[2]}.${m[3]}` } : null;
  })
  .filter(Boolean)
  .sort((a, b) => cmpVer(b.ver, a.ver));

const drop = packs.slice(KEEP);
for (const f of drop) {
  try {
    fs.unlinkSync(path.join(destDir, f.name));
    console.log(`  清理旧包 ${f.name}`);
  } catch (e) {
    console.warn(`  清理失败 ${f.name}: ${e.message}`);
  }
}
console.log(`  存档保留 ${Math.min(packs.length, KEEP)} 个版本：${packs.slice(0, KEEP).map((p) => p.ver).join(', ')}`);
