'use strict';

/* ------------------------------------------------------------------
   「按重复日提前提醒」UI 自测
   用法：node dev/tools/repeat-remind-check.js

   在真实编辑器里走一遍：
     点 + → 截止 2027-01-26 00:00 → 重复「每周」+ 周二 → 勾「从今天起按重复日提醒」
     → 提醒时间 09:00 → 保存
   然后检查：截止日期保持不变、勾选和提醒时间存下来、
   周二 09:30 判为「该提醒」、周一不提醒。
   ------------------------------------------------------------------ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.testdata', 'repeat-remind');
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
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ version: '0.0.0-test', url: '', notes: '' }));

const startPos = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;
const env = { ...process.env, DESKNOTE_DATA_DIR: DATA, DESKNOTE_UPDATE_URL: path.join(OUT, 'version.json') };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(ELECTRON, [ROOT, '--no-sandbox', '--test-repeat-remind'], {
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

  const line = text.split('\n').find((l) => l.includes('REPEATTEST :: '));
  const m = line && line.match(/REPEATTEST :: (\{.*\})/);
  if (!m) {
    console.log('  FAIL 没拿到 REPEATTEST 记录');
    console.log(text.split('\n').slice(-15).join('\n'));
    process.exit(1);
  }
  const { ui = {}, task = {}, info = {} } = JSON.parse(m[1]);

  check(ui.remindRowVisible === true, '勾「按重复日提醒」后出现「提醒时间」行');
  check(task.due === '2027-01-26T00:00', `截止日期保持 2027-01-26 00:00（实际 ${task.due}）`);
  check(task.repeat === 'weekly', `重复是每周（实际 ${task.repeat}）`);
  check(Array.isArray(task.repeatDays) && task.repeatDays.includes(2), `勾的是周二（实际 ${JSON.stringify(task.repeatDays)}）`);
  check(task.remindByRepeat === true, `存下 remindByRepeat=true（实际 ${task.remindByRepeat}）`);
  check(task.remindAt === '09:00', `提醒时间 09:00（实际 ${task.remindAt}）`);
  check(info.tue && info.tue.occurrence === true, '周二 09:30 判为「今天该提醒」');
  check(info.tue && info.tue.overdue === false, '还没到最后期限，不算逾期');
  check(info.mon === null, '周一不提醒');

  console.log(fails.length ? `\nrepeat-remind-check: ${fails.length} 项失败` : '\nrepeat-remind-check: 全部通过');
  process.exit(fails.length ? 1 : 0);
};

child.on('exit', () => setTimeout(finish, 300));
setTimeout(() => {
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  } catch {}
  setTimeout(finish, 500);
}, 30000);
