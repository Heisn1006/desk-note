'use strict';

/* 背景效果预览：node_modules\electron\dist\electron.exe --no-sandbox tools/bg-shot.js <图片路径>
   用真实渲染进程打开 index.html，走「设置 → 选择图片 → 浓度 → 确定」的真实流程，
   并把结果截图到 .testdata/bg-shots/。只用于自检，不碰用户数据。 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '.testdata', 'bg-shots');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', path.join(OUT, 'userdata'));

// Electron 会把 --no-sandbox 之类的启动参数也塞进 argv，这里只认以图片后缀结尾的那个
const candidates = process.argv
  .slice(1)
  .filter((a) => !a.startsWith('--') && /\.(jpe?g|png|webp|gif|bmp)$/i.test(a));
const src = candidates[candidates.length - 1];
if (!src) {
  console.error('用法: electron tools/bg-shot.js <图片路径>');
  app.exit(2);
}
const imgPath = path.resolve(src);
const imgUrl = 'file:///' + imgPath.replace(/\\/g, '/');
const tag = path.basename(imgPath).replace(/\.[^.]+$/, '');

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const now = new Date();
const at = (days, h, m) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return iso(d);
};

const tasks = [
  { id: 'p1', title: '论文初稿·第三章 实验与讨论', done: false, due: at(-1, 8, 30), hasTime: true, startAt: null, repeat: '', repeatDays: [] },
  { id: 'p2', title: 'CET-4 考试（准考证记得带）', done: false, due: at(0, 18, 0), hasTime: true, startAt: null, repeat: '', repeatDays: [] },
  { id: 'p3', title: '高铁纵横 复习', done: false, due: at(4, 20, 0), hasTime: true, startAt: null, repeat: '', repeatDays: [] },
];

let settings = {
  lang: 'zh-CN',
  theme: 'rose',
  uiScale: 1,
  hotkey: 'Control+Alt+N',
  autostart: false,
  bg: null,
  bgCrop: { zoom: 1, x: 0, y: 0 },
  bgFade: 0.55,
};

ipcMain.handle('state:load', () => ({ tasks, settings }));
ipcMain.handle('state:save', () => ({ ok: true }));
ipcMain.handle('settings:save', (_e, patch) => {
  settings = Object.assign({}, settings, patch || {});
  return settings;
});
ipcMain.handle('info:get', () => ({ version: '0.1.5-preview', hotkey: 'Ctrl + Alt + N' }));
ipcMain.handle('bg:pick', () => ({ url: imgUrl, name: path.basename(imgPath) }));
ipcMain.handle('bg:discard', () => true);
ipcMain.handle('hotkey:set', () => ({ ok: true, hotkey: 'Control+Alt+N' }));
for (const ch of ['win:mini', 'win:hide', 'win:quit', 'app:restart', 'ui:height', 'notify']) {
  ipcMain.on(ch, () => {});
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 384,
    height: 600,
    x: -3000,
    y: -3000,
    frame: false,
    show: true,
    backgroundColor: '#f4efe6',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await wait(500);

  // 真实 UI：打开设置 -> 点“选择图片” -> 裁切面板里把浓度调到 55% -> 确定
  await win.webContents.executeJavaScript(`(() => {
    document.getElementById('btnSettings').click();
    document.getElementById('btnPickBg').click();
  })()`);
  await wait(700);
  await win.webContents.executeJavaScript(`(() => {
    const fade = document.getElementById('cropFade');
    fade.value = '55';
    fade.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('cropApply').click();
  })()`);
  await wait(700);

  const probe = await win.webContents.executeJavaScript(`(() => ({
    bg: document.getElementById('bgLayer').hidden ? null : 'shown',
    crop: ${JSON.stringify(settings.bgCrop)},
    fade: ${settings.bgFade},
    imgW: Math.round(parseFloat(document.getElementById('bgImg').style.width)),
    cardW: document.getElementById('card').clientWidth,
  }))()`);

  const img = await win.webContents.capturePage();
  const file = path.join(OUT, `bg-${tag}.png`);
  fs.writeFileSync(file, img.toPNG());
  console.log(`OK ${tag} -> ${file} ${JSON.stringify(probe)}`);
  await wait(150);
  app.exit(0);
});
