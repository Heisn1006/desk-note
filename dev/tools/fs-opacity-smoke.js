'use strict';

/* ------------------------------------------------------------------
   全屏隐藏（透明方案）实机冒烟测试
   用法：node tools/fs-opacity-smoke.js      （需要真实桌面，不接进 check-all）

   做三件事：
   1. 用 DESKNOTE_DATA_DIR 起一个干净的测试实例（不碰用户数据），带 --test-fullscreen；
      主进程会按时间线自己驱动 onFullscreen(true/false)，每个阶段往 boot.log 写一行 FSTEST。
   2. 每个阶段用 GDI 截取便签窗口所在的矩形（tools/fs-shot.ps1），统计平均颜色。
   3. 断言：透明隐藏后那块屏幕回到桌面（颜色≈真隐藏时），恢复后又变回便签的样子，
      并且不透明度用的是设置值（0.85），窗口全程没有真的 hide 过。
   ------------------------------------------------------------------ */

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.testdata', 'fs-opacity');
const DATA = path.join(OUT, 'data');
const LOG = path.join(ROOT, 'boot.log');
const SHOT = path.join(__dirname, 'fs-shot.ps1');
const HIT = path.join(__dirname, 'fs-hit.ps1');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const VERSION = require(path.join(ROOT, 'package.json')).version;
const OPACITY = 0.85;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prepare() {
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
          opacity: OPACITY,
          collapsed: false,
          bounds: { x: 200, y: 240 },
          lang: 'zh-CN',
          hideOnFullscreen: true,
          trayHintShown: true, // 免得测试里 win.hide() 弹「图标在托盘」的气泡
          plugins: {},
        },
      },
      null,
      2
    )
  );
  // 检查更新指向本地清单：测试期间不碰网络
  fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ version: VERSION, url: '', notes: '' }));
}

// 从 boot.log 的旧末尾开始增量读，只认这次运行写进去的行
function makeLogReader() {
  let pos = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;
  return () => {
    let st;
    try {
      st = fs.statSync(LOG);
    } catch {
      return '';
    }
    if (st.size <= pos) return '';
    const fd = fs.openSync(LOG, 'r');
    const buf = Buffer.alloc(st.size - pos);
    try {
      fs.readSync(fd, buf, 0, buf.length, pos);
    } finally {
      fs.closeSync(fd);
    }
    pos = st.size;
    return buf.toString('utf8');
  };
}

function shot(rect, name) {
  const file = path.join(OUT, name + '.png');
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      SHOT,
      '-x',
      String(rect.x),
      '-y',
      String(rect.y),
      '-w',
      String(rect.w),
      '-h',
      String(rect.h),
      '-out',
      file,
    ],
    { encoding: 'utf8', timeout: 60000 }
  );
  const stat = JSON.parse(out.trim());
  stat.file = path.relative(ROOT, file);
  return stat;
}

function hitTest(rect, hwnd) {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HIT, '-x', String(Math.round(rect.x + rect.w / 2)), '-y', String(Math.round(rect.y + rect.h / 2)), '-hwnd', String(hwnd)],
    { encoding: 'utf8', timeout: 30000 }
  );
  return JSON.parse(out.trim());
}

const dist = (a, b) => Math.round(Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) * 10) / 10;

async function main() {
  prepare();
  const readLog = makeLogReader();

  const env = { ...process.env, DESKNOTE_DATA_DIR: DATA, DESKNOTE_UPDATE_URL: path.join(OUT, 'version.json') };
  delete env.ELECTRON_RUN_AS_NODE; // DSH 环境自带这个变量，不清掉 Electron 会当 node 跑

  const child = spawn(ELECTRON, [ROOT, '--no-sandbox', '--test-fullscreen'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  let exited = null;
  child.on('exit', (code, sig) => (exited = { code, sig }));

  const phases = [];
  const want = [
    'before',
    'alpha-hidden',
    'restored',
    'real-hidden',
    'shown-again',
    'tray-toggle-during-fullscreen',
    'capture-tool',
    'brief-fullscreen',
    'done',
  ];
  const deadline = Date.now() + 120000;
  let tail = '';

  try {
    while (Date.now() < deadline) {
      const chunk = readLog();
      if (chunk) {
        tail = (tail + chunk).split('\n').slice(-40).join('\n');
        for (const line of chunk.split('\n')) {
          const m = line.match(/FSTEST (\S+) :: (\{.*\})/);
          if (!m || !want.includes(m[1]) || phases.some((p) => p.tag === m[1])) continue;
          const info = JSON.parse(m[2]);
          const b = info.bounds;
          const s = info.scale || 1;
          const rect = {
            x: Math.round(b.x * s),
            y: Math.round(b.y * s),
            w: Math.round(b.width * s),
            h: Math.round(b.height * s),
          };
          await sleep(400); // 让合成器把这一帧画完再截
          let stat;
          try {
            stat = shot(rect, m[1]);
          } catch (e) {
            stat = { error: String(e && e.message ? e.message : e) };
          }
          let hit = null;
          try {
            hit = hitTest(rect, info.hwnd);
          } catch (e) {
            hit = { error: String(e && e.message ? e.message : e) };
          }
          phases.push({ tag: m[1], info, rect, stat, hit });
        }
      }
      if (phases.some((p) => p.tag === 'done') || exited) break;
      await sleep(120);
    }
  } finally {
    if (!exited) {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
    }
  }

  const by = Object.fromEntries(phases.map((p) => [p.tag, p]));
  console.log('阶段：');
  for (const p of phases) {
    const st = p.stat || {};
    console.log(
      `  ${p.tag.padEnd(26)} visible=${String(p.info.visible).padEnd(5)} opacity=${p.info.opacity} ` +
        `alpha=${p.info.hiddenByFullscreen} rect=${p.rect.x},${p.rect.y} ${p.rect.w}x${p.rect.h} ` +
        (st.error ? `截图失败 ${st.error}` : `mean=${st.r},${st.g},${st.b} sd=${st.sd}`) +
        (p.hit && !p.hit.error ? `  点击命中=${p.hit.rootMatch ? '便签' : p.hit.underClass || '其它'}` : '')
    );
  }

  let failed = 0;
  const check = (cond, msg) => {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
    if (!cond) failed++;
  };

  console.log('断言：');
  check(phases.length === want.length, `${want.length} 个阶段都跑到了（实际 ${phases.length}）`);

  const need = ['before', 'alpha-hidden', 'restored', 'real-hidden', 'tray-toggle-during-fullscreen'];
  const missing = need.filter((t) => !by[t] || by[t].stat.error);
  if (missing.length) {
    console.log(`缺少阶段或缺截图：${missing.join(', ')}`);
    failed++;
  } else {
    const b = by.before.stat;
    const a = by['alpha-hidden'].stat;
    const r = by.restored.stat;
    const h = by['real-hidden'].stat;
    const dBA = dist(b, a);
    const dAH = dist(a, h);
    const dBR = dist(b, r);
    console.log(`  颜色差：before↔alpha-hidden=${dBA}  alpha-hidden↔real-hidden=${dAH}  before↔restored=${dBR}`);

    // 关键：如果 setOpacity 在透明窗口上其实是空操作，alpha-hidden 会和 before 几乎一样（dBA≈0）
    check(dBA > 25, `透明隐藏后那块屏幕明显变了（before↔alpha-hidden=${dBA} > 25）`);
    check(dAH < 20, `透明隐藏后看起来就是桌面，和真隐藏一致（${dAH} < 20）`);
    check(dBR < 20, `恢复后画面回到便签的样子（before↔restored=${dBR} < 20）`);

    // 状态断言（来自主进程自己写的日志）
    check(by.before.info.visible === true && by.before.info.opacity === OPACITY, '开始前：可见、不透明度=设置值');
    check(by['alpha-hidden'].info.opacity === 0, '全屏隐藏：opacity=0（不是 win.hide）');
    check(by['alpha-hidden'].info.visible === true, '全屏隐藏期间窗口仍然 visible=true（没有 hide/show）');
    check(by.restored.info.opacity === OPACITY && by.restored.info.hiddenByFullscreen === false, '退出全屏：恢复成设置的不透明度');
    check(by['real-hidden'].info.visible === false, '对照：win.hide() 才是真的 visible=false');
    check(
      by['tray-toggle-during-fullscreen'].info.visible === true &&
        by['tray-toggle-during-fullscreen'].info.opacity === OPACITY &&
        by['tray-toggle-during-fullscreen'].info.hiddenByFullscreen === false,
      '全屏中点托盘/快捷键：直接把便签显出来，不会再藏一次'
    );
    check(
      by['capture-tool'].info.visible === true &&
        by['capture-tool'].info.opacity === OPACITY &&
        by['capture-tool'].info.hiddenByFullscreen === false,
      '截图工具的假全屏（snippingtool.exe）完全不触发隐藏'
    );
    check(
      by['brief-fullscreen'].info.visible === true &&
        by['brief-fullscreen'].info.opacity === OPACITY &&
        by['brief-fullscreen'].info.hiddenByFullscreen === false,
      '短于防抖（80ms < 150ms）的一闪而过不触发隐藏'
    );

    // 鼠标穿透：全屏隐藏后点击必须落到下面的窗口，不能还落在便签上（游戏里能点到便签就是这个 bug）
    if (by.before.hit && by.before.hit.error) {
      check(false, '命中测试没跑起来：' + by.before.hit.error);
    } else {
      check(by.before.hit.rootMatch === true, '正常状态：点击落在便签上');
      check(by['alpha-hidden'].hit.rootMatch === false, '透明隐藏后：点击穿过便签，落到下面的窗口');
      check(by['alpha-hidden'].hit.noteTransparent === true, '透明隐藏后：窗口带 WS_EX_TRANSPARENT（鼠标穿透真的生效）');
      check(by.restored.hit.rootMatch === true, '恢复后：点击又落在便签上');
    }

  }

  if (failed) {
    console.log('\n最近日志：');
    console.log(tail);
    if (stderr.trim()) {
      console.log('\nstderr：');
      console.log(stderr.trim().split('\n').slice(-15).join('\n'));
    }
  }
  console.log(failed ? `\nfs-opacity-smoke: ${failed} 项失败` : '\nfs-opacity-smoke: 全部通过');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('fs-opacity-smoke 异常：', e);
  process.exit(1);
});
