'use strict';

/* ------------------------------------------------------------------
   列表重绘自测（诊断「任务行闪一下」）
   用法：node dev/tools/watch-list-check.js

   起一个带「每周提醒」任务的实例，空闲 60 秒，用 MutationObserver 记录 #list 的变动。
   期望：**0 次**。以前 render() 每 30 秒无条件重写 innerHTML，透明窗口上看起来就是
   列表/任务行闪一下；现在只有内容真的变了才写 DOM。
   ------------------------------------------------------------------ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.testdata', 'watch-list');
const DATA = path.join(OUT, 'data');
const LOG = path.join(ROOT, 'boot.log');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!cond) fails.push(msg);
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const far = new Date();
far.setDate(far.getDate() + 30);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(
  path.join(DATA, 'state.json'),
  JSON.stringify(
    {
      version: 2,
      tasks: [
        {
          id: 'w1',
          title: '每周提醒任务',
          done: false,
          due: iso(far),
          hasTime: true,
          repeat: 'weekly',
          repeatDays: [new Date().getDay()],
          remindByRepeat: true,
          remindAt: '00:00',
        },
        { id: 'w2', title: '普通任务', done: false, due: iso(far), hasTime: true, repeat: '', repeatDays: [] },
      ],
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
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ version: '0.0.0-test', url: '', notes: '' }));

const startPos = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;
const env = { ...process.env, DESKNOTE_DATA_DIR: DATA, DESKNOTE_UPDATE_URL: path.join(OUT, 'version.json') };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(ELECTRON, [ROOT, '--no-sandbox', '--test-watch-list'], {
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

  const line = text.split('\n').find((l) => l.includes('WATCHLIST :: '));
  const m = line && line.match(/WATCHLIST :: (\{.*\})/);
  if (!m) {
    console.log('  FAIL 没拿到 WATCHLIST 记录');
    process.exit(1);
  }
  const { events = -1, sample = [] } = JSON.parse(m[1]);
  console.log('  60 秒内列表变动：' + events + ' 次' + (sample.length ? '，前几次在 ' + sample.map((e) => e.t + 'ms').join(', ') : ''));

  check(events === 0, '空闲 60 秒内列表不再整体重渲染（任务行不会闪）');

  console.log(fails.length ? `\nwatch-list-check: ${fails.length} 项失败` : '\nwatch-list-check: 全部通过');
  process.exit(fails.length ? 1 : 0);
};

child.on('exit', () => setTimeout(finish, 300));
setTimeout(() => {
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  } catch {}
  setTimeout(finish, 500);
}, 90000);
