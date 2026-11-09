'use strict';

/* ------------------------------------------------------------------
   「每天」重复（无截止日期）UI 自测
   用法：node dev/tools/daily-task-check.js

   真起 Electron，用 --test-daily-task 钩子在真实编辑器里走一遍：
     取消「设置截止日期」→ 重复选「每天」→ 填 00:00 → 保存
   然后检查：
     1. 选「每天」后「每天提醒时间」行要出现，且取消截止日期不会把重复清掉；
     2. 存下来的任务 due=null、repeat='daily'、remindAt='00:00'；
     3. remindInfo 当场返回 daily（到点，算在提醒里），且不算逾期。
   ------------------------------------------------------------------ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.testdata', 'daily-task');
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

const child = spawn(ELECTRON, [ROOT, '--no-sandbox', '--test-daily-task'], {
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

  const line = text.split('\n').find((l) => l.includes('DAILYTEST :: '));
  const m = line && line.match(/DAILYTEST :: (\{.*\})/);
  if (!m) {
    console.log('  FAIL 没拿到 DAILYTEST 记录（界面步骤可能没跑完）');
    console.log(text.split('\n').slice(-15).join('\n'));
    process.exit(1);
  }
  const info = JSON.parse(m[1]);
  const ui = info.ui || {};
  const task = info.task || {};
  const remind = info.remind || {};

  check(ui.remindRowVisible === true, '选「每天」后「每天提醒时间」行会出现');
  check(ui.repeatKept === true, '取消截止日期后「每天」这个重复不会被清掉');
  check(task.due === null, `存下来的任务没有截止日期（实际 ${task.due}）`);
  check(task.repeat === 'daily', `存下来的任务是每天重复（实际 ${task.repeat}）`);
  check(task.remindAt === '00:00', `提醒时间存成 00:00（实际 ${task.remindAt}）`);
  check(remind && remind.daily === true, `到点后进入提醒，且标记为每天（实际 ${JSON.stringify(remind)}）`);
  check(remind && remind.overdue === false, '每天任务不算逾期');

  console.log(fails.length ? `\ndaily-task-check: ${fails.length} 项失败` : '\ndaily-task-check: 全部通过');
  process.exit(fails.length ? 1 : 0);
};

child.on('exit', () => setTimeout(finish, 300));
setTimeout(() => {
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  } catch {}
  setTimeout(finish, 500);
}, 30000);
