'use strict';

/* ------------------------------------------------------------------
   迷你态（展开 / 收起）能不能跨进程保持？—— 自动验证
   用法：node dev/tools/mini-persist-check.js

   模拟两件事：
   1. 用户把便签收起来 → 程序退出（相当于关机 / 重启）→ 再启动，看是否还是收起；
   2. 反过来展开后退出，再启动是否还是展开；
   3. 便签贴在屏幕顶边（贴顶）时收起 → 冷启动后不能被贴顶检测撑开。

   睡眠唤醒不重启进程，状态在内存里，属于另一条路径（见交接文档）。

   每个阶段都真起一个 Electron 实例（DESKNOTE_DATA_DIR 指到临时目录），
   用 --test-mini-persist=<phase> 让它记录窗口 bounds 后自己退出。
   ------------------------------------------------------------------ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.testdata', 'mini-persist');
const DATA = path.join(OUT, 'data');
const LOG = path.join(ROOT, 'boot.log');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

// 150% 缩放下窗口高度会有 1~2 像素的 DIP 取整，用区间判断形态而不是死磕数值
const isExpanded = (h) => typeof h === 'number' && h > 400;
const isMini = (h) => typeof h === 'number' && h <= 100;

const fails = [];
const check = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!cond) fails.push(msg);
};

function seed(bounds) {
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
          bounds,
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
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'state.json'), 'utf8'));
  } catch {
    return null;
  }
}

// 起一个实例跑某个阶段，返回它写进 boot.log 的 MINITEST 行
function runPhase(phase) {
  return new Promise((resolve) => {
    const startPos = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;
    const env = { ...process.env, DESKNOTE_DATA_DIR: DATA, DESKNOTE_UPDATE_URL: path.join(OUT, 'version.json') };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(ELECTRON, [ROOT, '--no-sandbox', '--test-mini-persist=' + phase], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let done = false;
    const finish = (code) => {
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
      const lines = [];
      for (const line of text.split('\n')) {
        const m = line.match(/MINITEST (\S+) :: (\{.*\})/);
        if (m) lines.push({ tag: m[1], info: JSON.parse(m[2]) });
      }
      resolve({ code, lines });
    };
    child.on('exit', (code) => finish(code));
    setTimeout(() => {
      try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      } catch {}
      finish('timeout');
    }, 25000);
  });
}

const byTag = (r, tag) => r.lines.find((l) => l.tag === tag);

(async () => {
  // ---------- 普通位置 ----------
  seed({ x: 200, y: 240 });

  console.log('阶段 1：全新数据（展开）启动');
  let r = await runPhase('read');
  let boot = byTag(r, 'read-start');
  check(!!boot, '启动后写回了 MINITEST 记录');
  check(boot && isExpanded(boot.info.bounds.height), `全新启动是展开态（高度 ${boot && boot.info.bounds.height}）`);

  console.log('阶段 2：收起后退出');
  r = await runPhase('collapse');
  let after = byTag(r, 'collapse-after');
  check(after && isMini(after.info.bounds.height), `收起后窗口是迷你条（高度 ${after && after.info.bounds.height}）`);
  let st = readState();
  check(st && st.settings.collapsed === true, `state.json 记住 collapsed=true（实际 ${st && st.settings.collapsed}）`);

  console.log('阶段 3：收起状态下冷启动（相当于关机后开机自启）');
  r = await runPhase('read');
  boot = byTag(r, 'read-start');
  check(boot && isMini(boot.info.bounds.height), `冷启动后仍是收起（高度 ${boot && boot.info.bounds.height}）`);

  console.log('阶段 4：展开后退出');
  r = await runPhase('expand');
  after = byTag(r, 'expand-after');
  check(after && isExpanded(after.info.bounds.height), `展开后窗口是展开态（高度 ${after && after.info.bounds.height}）`);
  st = readState();
  check(st && st.settings.collapsed === false, `state.json 记住 collapsed=false（实际 ${st && st.settings.collapsed}）`);

  console.log('阶段 5：展开状态下冷启动');
  r = await runPhase('read');
  boot = byTag(r, 'read-start');
  check(boot && isExpanded(boot.info.bounds.height), `冷启动后仍是展开（高度 ${boot && boot.info.bounds.height}）`);

  // ---------- 贴顶位置（用户的真实用法） ----------
  seed({ x: 200, y: 0 });
  console.log('阶段 6：贴顶 + 收起后退出');
  r = await runPhase('collapse');
  after = byTag(r, 'collapse-after');
  check(after && isMini(after.info.bounds.height), `贴顶收起后是迷你条（高度 ${after && after.info.bounds.height}）`);

  console.log('阶段 7：贴顶 + 收起状态下冷启动');
  r = await runPhase('read');
  boot = byTag(r, 'read-start');
  check(boot && isMini(boot.info.bounds.height), `冷启动后仍是贴顶迷你条（高度 ${boot && boot.info.bounds.height}，没被贴顶检测撑开）`);

  console.log(fails.length ? `\nmini-persist-check: ${fails.length} 项失败` : '\nmini-persist-check: 全部通过');
  process.exit(fails.length ? 1 : 0);
})();
