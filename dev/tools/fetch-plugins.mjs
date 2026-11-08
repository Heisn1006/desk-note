#!/usr/bin/env node
'use strict';

/* ------------------------------------------------------------------
   按 plugins/lock.json 把插件源码拉进 plugins/<id>/

   用法：
     node dev/tools/fetch-plugins.mjs
         按 lock.json 里的 repo + tag 做 `git clone --depth 1 --branch <tag>`。
         需要走代理时先 `set HTTPS_PROXY=http://127.0.0.1:7897`（git 认这个变量）。

     node dev/tools/fetch-plugins.mjs --from ..\desk-note-plugins
         直接从本地插件仓库拷（离线、或者正在改插件时用）。

   为什么拉到 plugins/：安装包里要内置插件，运行时宿主也只认 plugins/<id>/。
   拉下来的插件目录被 .gitignore 忽略，不会进主仓库。
   ------------------------------------------------------------------ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');
const PLUGINS = path.join(ROOT, 'plugins');
const TMP = path.join(ROOT, '.testdata', 'plugins-src');

const argv = process.argv.slice(2);
const fromArg = argv.indexOf('--from');
const fromDir = fromArg >= 0 ? path.resolve(argv[fromArg + 1] || '') : null;

function readLock() {
  const p = path.join(PLUGINS, 'lock.json');
  if (!fs.existsSync(p)) throw new Error('找不到 plugins/lock.json');
  const lock = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(lock.plugins) || !lock.plugins.length) throw new Error('lock.json 里没有 plugins 列表');
  return lock;
}

function copyPlugin(src, id) {
  const from = path.join(src, id);
  if (!fs.existsSync(path.join(from, 'plugin.json'))) {
    throw new Error(`插件 ${id} 在 ${from} 里没有 plugin.json`);
  }
  const dest = path.join(PLUGINS, id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(from, dest, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'plugin.json'), 'utf8'));
  console.log(`  ✓ ${id} ${manifest.version || '?'} → plugins/${id}/`);
}

const lock = readLock();
let src = fromDir;
let cloned = false;

if (!src) {
  if (!lock.repo || !lock.tag) throw new Error('lock.json 缺 repo/tag');
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(TMP), { recursive: true });
  console.log(`克隆插件仓库 ${lock.repo} @ ${lock.tag} …`);
  try {
    execFileSync('git', ['clone', '--depth', '1', '--branch', lock.tag, lock.repo, TMP], {
      stdio: 'inherit',
      env: process.env,
    });
  } catch {
    throw new Error(
      'git clone 失败：网络不通就设 HTTPS_PROXY，或改用 --from <本地插件仓库目录>'
    );
  }
  src = TMP;
  cloned = true;
}

if (!fs.existsSync(src)) throw new Error('插件来源不存在：' + src);

console.log(`插件来源：${src}`);
for (const id of lock.plugins) copyPlugin(src, id);

if (cloned) fs.rmSync(TMP, { recursive: true, force: true });
console.log('完成。');
