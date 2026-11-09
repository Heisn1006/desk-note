'use strict';

/* ------------------------------------------------------------------
   分组自测：重复任务要分到「每天 / 每周 / 每月」而不是都堆在「更远 / 无日期」
   用法：node dev/tools/grouping-check.js

   种 4 条任务（都不在近 7 天）：
     一次性远期 / 每周 / 每天（无截止）/ 每月
   期望列表里的分组标题依次是：更远 / 无日期 → 每天 → 每周 → 每月
   ------------------------------------------------------------------ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.testdata', 'grouping');
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
const day = (offset, h = 18, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
};

const far = iso(day(30));
const farDate = day(30);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(
  path.join(DATA, 'state.json'),
  JSON.stringify(
    {
      version: 2,
      tasks: [
        { id: 'a', title: '一次性远期', done: false, due: far, hasTime: true, repeat: '', repeatDays: [] },
        {
          id: 'b',
          title: '每周任务',
          done: false,
          due: far,
          hasTime: true,
          repeat: 'weekly',
          repeatDays: [farDate.getDay()],
        },
        {
          id: 'c',
          title: '每天任务',
          done: false,
          due: null,
          hasTime: false,
          repeat: 'daily',
          remindAt: '09:00',
          repeatDays: [],
        },
        {
          id: 'd',
          title: '每月任务',
          done: false,
          due: far,
          hasTime: true,
          repeat: 'monthly',
          monthDays: [farDate.getDate()],
          monthlyMonths: [],
        },
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

const child = spawn(ELECTRON, [ROOT, '--no-sandbox', '--test-groups'], {
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

  const line = text.split('\n').find((l) => l.includes('GROUPTEST :: '));
  const m = line && line.match(/GROUPTEST :: (\{.*\})/);
  if (!m) {
    console.log('  FAIL 没拿到 GROUPTEST 记录');
    console.log(text.split('\n').slice(-12).join('\n'));
    process.exit(1);
  }
  const headers = JSON.parse(m[1]).headers || [];
  console.log('  实际分组：' + JSON.stringify(headers));

  const expected = ['更远 / 无日期', '每天', '每周', '每月'];
  check(headers.length === 4, `列表里 4 个分组（实际 ${headers.length}）`);
  expected.forEach((name, i) => check(headers[i] === name, `第 ${i + 1} 个分组是「${name}」（实际 ${headers[i]}）`));

  console.log(fails.length ? `\ngrouping-check: ${fails.length} 项失败` : '\ngrouping-check: 全部通过');
  process.exit(fails.length ? 1 : 0);
};

child.on('exit', () => setTimeout(finish, 300));
setTimeout(() => {
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  } catch {}
  setTimeout(finish, 500);
}, 30000);
