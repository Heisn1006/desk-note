'use strict';

/* ------------------------------------------------------------------
   全屏自动隐藏用的「透明 + 鼠标穿透」（不依赖 Electron，可以 node 测）

   为什么不再用 win.hide() / win.showInactive()：
   Windows 上透明无边框窗口 show 的那一瞬间，合成器会先把上一帧（或空帧）贴上去，
   下一页才刷新 —— 看起来就是「先露一下、内容再跳出来」，也就是退出全屏时的闪烁。
   窗口不真的藏起来、只把不透明度打到 0，恢复时只是把不透明度写回去，
   没有重新 show 这一步，也就没有那一帧。

   两条必须守住的不变量：
   1. opacity 为 0 的窗口仍然占着那块屏幕，必须同时打开鼠标穿透；恢复时必须关掉，
      否则便签会把桌面上的点击吃掉。
   2. 恢复的不透明度要回到用户设置的值（settings.opacity），不能写死 1。
   ------------------------------------------------------------------ */

// 只接受 0..1 的有限数；其它（未设置 / 脏数据）一律回到 1，避免「恢复之后看不见」。
// 注意 null / '' 会被 Number() 变成 0，必须先挡掉，不能落进合法范围。
const safeOpacity = (v) => {
  if (v === null || v === undefined || v === '') return 1;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1;
};

// win 只要有 setOpacity / setIgnoreMouseEvents 两个方法就能测（真窗口、假窗口都行）
function hide(win) {
  win.setOpacity(0);
  // 不 forward：透明期间不需要把鼠标移动转给页面，免得看不见的页面还在响应悬停
  win.setIgnoreMouseEvents(true);
}

function restore(win, opacity) {
  win.setIgnoreMouseEvents(false);
  win.setOpacity(safeOpacity(opacity));
}

// 截图 / 录屏工具的浮层也会铺满屏幕，被探测器当成「全屏应用」。
// 这些进程当前台时不要隐藏便签 —— 否则截一张图，便签就藏一下再放回来（闪）。
// 只认 exe 文件名，大小写不敏感；列表放这里，改起来不用重编探测器。
const CAPTURE_EXES = new Set([
  'snippingtool.exe',   // Windows 11 截图工具（Win+Shift+S）
  'screenclipper.exe',  // 旧版截图浮层
  'screensketch.exe',
  'snipaste.exe',
  'sharex.exe',
  'greenshot.exe',
  'fscapture.exe',
  'picpick.exe',
  'lightshot.exe',
  'obs64.exe',          // 录屏
  'obs32.exe',
  'bandicam.exe',
  'fraps.exe',
]);

function isCaptureTool(name) {
  if (!name) return false;
  const base = String(name).split(/[\\/]/).pop().toLowerCase();
  return CAPTURE_EXES.has(base);
}

module.exports = { hide, restore, safeOpacity, isCaptureTool, CAPTURE_EXES };
