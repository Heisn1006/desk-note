'use strict';

/* 全屏隐藏（透明方案）单元测试：node tools/fullscreen-check.js
   用假窗口记录调用，守住 lib/fullscreen-hide.js 的两条不变量：
   - 隐藏 = opacity 0 + 打开鼠标穿透；恢复 = 关掉穿透 + 不透明度回到设置值
   - 恢复不能写死 1，脏值不能把窗口恢复成看不见 */

const assert = require('node:assert');
const fh = require('../lib/fullscreen-hide.js');

let n = 0;
const eq = (a, b, msg) => {
  n++;
  assert.strictEqual(a, b, `${msg}（实际 ${a}）`);
};
const ok = (cond, msg) => {
  n++;
  assert.ok(cond, msg);
};

function fakeWin() {
  const calls = [];
  const w = {
    opacity: 1,
    ignore: false,
    calls,
    setOpacity(v) {
      calls.push(['opacity', v]);
      w.opacity = v;
    },
    setIgnoreMouseEvents(v, opts) {
      calls.push(['ignore', v, opts]);
      w.ignore = v;
    },
  };
  return w;
}

/* 1. 隐藏：不透明度打到 0，同时打开鼠标穿透 */
const a = fakeWin();
fh.hide(a);
eq(a.opacity, 0, '隐藏时 opacity=0');
eq(a.ignore, true, '隐藏时打开鼠标穿透');
ok(
  !a.calls.some((c) => c[0] === 'ignore' && c[2] && c[2].forward),
  '隐藏时不 forward 鼠标事件（看不见的页面不该再响应悬停）'
);

/* 2. 恢复：穿透关掉，不透明度用 settings.opacity，而不是写死 1 */
const b = fakeWin();
fh.hide(b);
fh.restore(b, 0.85);
eq(b.opacity, 0.85, '恢复时用 settings.opacity');
eq(b.ignore, false, '恢复时关掉鼠标穿透');

/* 3. 未设置 / 脏值：回到 1，绝不能恢复成 0（那样等于一直看不见） */
for (const v of [undefined, null, NaN, Infinity, 'abc', -0.5, 1.5]) {
  const w = fakeWin();
  fh.hide(w);
  fh.restore(w, v);
  eq(w.opacity, 1, `不透明度 ${String(v)} 视为未设置 → 1`);
  eq(w.ignore, false, `不透明度 ${String(v)} 时仍然关掉鼠标穿透`);
}

/* 4. 边界值 0 / 1 原样保留（0 是显式设置，设置项本身为 0 时启动也是看不见的） */
const c0 = fakeWin();
fh.restore(c0, 0);
eq(c0.opacity, 0, '显式 0 原样保留');
const c1 = fakeWin();
fh.restore(c1, 1);
eq(c1.opacity, 1, '显式 1 原样保留');

/* 5. 恢复时先关穿透再写不透明度（顺序无关紧要，但两次调用都要有） */
const d = fakeWin();
fh.restore(d, 0.6);
eq(d.calls.length, 2, '恢复恰好两次调用');
eq(d.calls[0][0], 'ignore', '先恢复鼠标事件');
eq(d.calls[1][0], 'opacity', '再写不透明度');

/* 6. 截图 / 录屏工具：按 exe 名认出来（带路径、大小写都能认） */
for (const n of [
  'SnippingTool.exe',
  'snippingtool.EXE',
  'C:\\Program Files\\WindowsApps\\SnippingTool.exe',
  'obs64.exe',
  'Snipaste.exe',
]) {
  ok(fh.isCaptureTool(n), `识别截图工具 ${n}`);
}
for (const n of ['chrome.exe', 'explorer.exe', 'code.exe', 'snipping', '', null, undefined, 'snip.exe.bak']) {
  ok(!fh.isCaptureTool(n), `不算截图工具 ${String(n)}`);
}

console.log(`fullscreen-check: ${n} 项通过`);
