'use strict';

/* ------------------------------------------------------------------
   更新面板 UI 自测
   用法：node dev/tools/update-panel-check.js

   用 DESKNOTE_UPDATE_URL 指一个本地假清单（版本 9.9.9），让程序真的走一遍：
     点「检查更新」→ 便签窗口里浮出更新面板（两个按钮：更新 / 不更新）
     → 点「不更新」→ 面板消失、settings.updateSkipped 记住这个版本
   另外把主题切到 night 前后各读一次面板背景色，确认背景跟随主题（用的是便签自己的主题变量）。
   ------------------------------------------------------------------ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.testdata', 'update-panel');
const DATA = path.join(OUT, 'data');
const LOG = path.join(ROOT, 'boot.log');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!cond) fails.push(msg);
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(
  path.join(DATA, 'state.json'),
  JSON.stringify(
    {
      version: 2,
      tasks: [],
      settings: {
        autostart: false,
        alwaysOnTop: true,
        opacity: 1,
        collapsed: false,
        bounds: { x: 200, y: 240 },
        lang: 'zh-CN',
        hideOnFullscreen: true,
        trayHintShown: true,
        plugins: {},
      },
    },
    null,
    2
  )
);
// 假清单：版本 9.9.9，带说明
fs.writeFileSync(
  path.join(OUT, 'version.json'),
  JSON.stringify(
    {
      version: '9.9.9',
      url: 'https://github.com/Heisn1006/desk-note/releases/latest',
      notes: '测试更新说明：这次更新了更新面板。',
    },
    null,
    2
  )
);

const startPos = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;
const env = { ...process.env, DESKNOTE_DATA_DIR: DATA, DESKNOTE_UPDATE_URL: path.join(OUT, 'version.json') };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(ELECTRON, [ROOT, '--no-sandbox', '--test-update-panel'], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'ignore', 'ignore'],
});

let done = false;
const finish = () => {
  if (done) return;
  done = true;
  let text = '';
  try {
    const fd = fs.openSync(LOG, 'r');
    const size = fs.fstatSync(fd).size;
    if (size > startPos) {
      const buf = Buffer.alloc(size - startPos);
      fs.readSync(fd, buf, 0, buf.length, startPos);
      text = buf.toString('utf8');
    }
    fs.closeSync(fd);
  } catch {}

  const line = text.split('\n').find((l) => l.includes('UPDATETEST :: '));
  const m = line && line.match(/UPDATETEST :: (\{.*\})/);
  if (!m) {
    console.log('  FAIL 没拿到 UPDATETEST 记录');
    console.log(text.split('\n').slice(-12).join('\n'));
    process.exit(1);
  }
  const { info = {}, skipped = '', panelHidden } = JSON.parse(m[1]);

  check(info.visible === true, '发现新版本后，便签窗口里浮出更新面板');
  check(info.title === 'v9.9.9', `面板显示新版本号 v9.9.9（实际 ${info.title}）`);
  check(String(info.notes).includes('测试更新说明'), '面板显示更新说明');
  check(info.btnCount === 2, `面板里恰好两个按钮（更新 / 不更新，实际 ${info.btnCount} 个）`);
  check(!!info.bg && !!info.bgNight && info.bg !== info.bgNight, `面板背景跟随主题（paper=${info.bg} / night=${info.bgNight}）`);
  check(skipped === '9.9.9', `点「不更新」记住跳过的版本（实际 ${skipped}）`);
  check(panelHidden === true, '点「不更新」后面板收起');

  console.log(fails.length ? `\nupdate-panel-check: ${fails.length} 项失败` : '\nupdate-panel-check: 全部通过');
  process.exit(fails.length ? 1 : 0);
};

child.on('exit', () => setTimeout(finish, 300));
setTimeout(() => {
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  } catch {}
  setTimeout(finish, 500);
}, 30000);
