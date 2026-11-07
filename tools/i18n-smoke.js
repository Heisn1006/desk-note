'use strict';

/* ------------------------------------------------------------------
   i18n 运行时冒烟测试（在 Electron 里真开一个窗口跑）
   - 用真实 UI 事件切换语言（改 #spLang + dispatch change），不走后门
   - 每种语言都截图：列表 / 设置 / 编辑器 / 迷你条
   - 硬性断言：用户自定义的待办标题在切语言后逐字不变
   - 顺带查：data-i18n 节点没被写坏、文本有没有溢出容器
   用法：
     node_modules\electron\dist\electron.exe --no-sandbox --disable-gpu tools/i18n-smoke.js
   ------------------------------------------------------------------ */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.testdata', 'i18n');
fs.mkdirSync(OUT, { recursive: true });

// 本机 %APPDATA% 会被拦，Electron 用默认 userData 会直接 0xC0000005；先指到可写目录
app.setPath('userData', path.join(OUT, 'userdata'));

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const now = new Date();
const at = (dayOffset, h, m) => {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return iso(d);
};

// 用户自己命名的标题：故意混中文、英文、数字、标点，用来验证「切语言不改标题」
const TITLES = {
  t1: '论文初稿·第三章 实验与讨论',
  t2: 'CET-4 考试（准考证记得带）',
  t3: 'Weekly 周报 · 第 12 期',
  t4: '高铁纵横 复习',
  t5: '买猫粮',
  t6: '已完成的老任务',
};
const tasks = [
  { id: 't1', title: TITLES.t1, done: false, due: at(0, 8, 30), hasTime: true, startAt: at(-2, 9, 0), repeat: '', repeatDays: [] },
  { id: 't2', title: TITLES.t2, done: false, due: at(0, 23, 59), hasTime: false, startAt: null, repeat: '', repeatDays: [] },
  { id: 't3', title: TITLES.t3, done: false, due: at(1, 18, 0), hasTime: true, startAt: null, repeat: 'weekly', repeatDays: [1, 5] },
  { id: 't4', title: TITLES.t4, done: false, due: at(4, 20, 0), hasTime: true, startAt: null, repeat: '', repeatDays: [] },
  { id: 't5', title: TITLES.t5, done: false, due: null, hasTime: false, startAt: null, repeat: '', repeatDays: [] },
  { id: 't6', title: TITLES.t6, done: true, doneAt: iso(now), due: at(-1, 12, 0), hasTime: true, startAt: null, repeat: '', repeatDays: [] },
];

let settings = { lang: 'zh-CN', theme: 'paper', uiScale: 1, hotkey: 'Control+Alt+N', autostart: false, bg: null };
const notified = [];
const savedLists = [];
let win = null;

ipcMain.handle('state:load', () => ({ tasks: JSON.parse(JSON.stringify(tasks)), settings }));
ipcMain.handle('state:save', (_e, list) => {
  savedLists.push(JSON.parse(JSON.stringify(list || [])));
  return { ok: true, count: (list || []).length };
});
ipcMain.handle('settings:save', (_e, patch) => {
  settings = Object.assign({}, settings, patch || {});
  return settings;
});
ipcMain.handle('info:get', () => ({ version: '0.1.2-smoke', hotkey: 'Ctrl + Alt + N', statePath: OUT, isPackaged: false }));
const bgFiles = ['white-cat.jpg', 'hat-girl.jpg'].map(
  (n) => 'file:///' + path.join(ROOT, '.testdata', 'images', n).replace(/\\/g, '/')
);
let bgPickIndex = 0;
const discarded = [];
ipcMain.handle('bg:pick', () => ({ url: bgFiles[Math.min(bgPickIndex++, bgFiles.length - 1)], name: 'stub.jpg' }));
ipcMain.handle('bg:discard', (_e, url) => {
  discarded.push(url);
  return true;
});
ipcMain.handle('data:export', () => ({ ok: true, count: tasks.length, path: 'stub.json' }));
ipcMain.handle('data:import', () => ({
  ok: true,
  added: 1,
  skipped: 1,
  tasks: [
    {
      id: 'imp1',
      title: '导入进来的任务：别动我',
      done: false,
      due: null,
      hasTime: false,
      startAt: null,
      repeat: '',
      repeatDays: [],
      createdAt: new Date().toISOString(),
    },
    // 渲染层首启会把全角括号规范化成【】，这里模拟同一份数据，避免把「未规范化」的旧值塞回去
    ...JSON.parse(JSON.stringify(tasks)).map((t) => ({
      ...t,
      title: t.title.replace(/（/g, '【').replace(/）/g, '】'),
    })),
  ],
}));
ipcMain.handle('hotkey:set', () => ({ ok: true, hotkey: 'Control+Alt+N' }));
ipcMain.handle('display:info', () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 }));
ipcMain.handle('we:info', () => ({
  file: path.join(ROOT, '.testdata', 'images', 'twin-tail.jpg'),
  preview: path.join(ROOT, '.testdata', 'images', 'twin-tail.jpg'),
  video: '',
  mtime: 1,
  title: 'test',
}));
ipcMain.handle('wallpaper:get', () => ({ path: path.join(ROOT, '.testdata', 'images', 'white-cat.jpg'), style: 10, tile: false, mtime: 123 }));
ipcMain.handle('plugins:list', () => ([{ id: 'wallpaper', name: '壁纸穿透', description: '把桌面壁纸映射到便签背景', version: '0.1.0', enabled: !!(settings.plugins || {}).wallpaper }]));
ipcMain.on('notify', (_e, payload) => notified.push(payload));
for (const ch of ['win:mini', 'win:hide', 'win:quit', 'app:restart', 'ui:height']) {
  ipcMain.on(ch, () => {});
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (code) => win.webContents.executeJavaScript(code);

async function shot(name) {
  await wait(140);   // 等这一帧画完，避免截到上一个状态
  let img = null;
  for (let i = 0; i < 3 && !img; i++) {
    try {
      img = await win.webContents.capturePage();
    } catch (err) {
      console.error('capturePage failed, retry', i, err && err.message);
      await wait(400);
    }
  }
  if (!img) return { file: null, size: { width: 0, height: 0 } };
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, img.toPNG());
  return { file, size: img.getSize() };
}

async function readUI() {
  return js(`(() => {
    const strip = (s) => String(s).replace(/\\u{1F514}/gu, '').trim();
    const titles = [...document.querySelectorAll('.task')].map((el) => ({
      id: el.dataset.id,
      title: strip((el.querySelector('.title') || {}).textContent || ''),
    }));
    const staticNodes = [...document.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-ph]')].map((el) => ({
      key: el.getAttribute('data-i18n') || el.getAttribute('data-i18n-title') || el.getAttribute('data-i18n-ph'),
      hasText: el.hasAttribute('data-i18n'),
      children: el.children.length,
      text: (el.textContent || '').trim().slice(0, 60),
      title: el.getAttribute('title') || '',
    }));
    const overflow = [];
    document.querySelectorAll('#card *').forEach((el) => {
      if (el.children.length) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (!el.clientWidth) return;
      if (cs.textOverflow === 'ellipsis') return;            // 省略号是设计好的
      if (el.scrollWidth > el.clientWidth + 1) {
        overflow.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 40),
          id: el.id,
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          clipped: getComputedStyle(el).overflow !== 'visible',
          text: (el.textContent || '').trim().slice(0, 50),
        });
      }
    });
    return {
      lang: document.documentElement.getAttribute('lang'),
      i18nLang: window.i18n.getLang(),
      titles,
      staticNodes,
      overflow,
      header: {
        day: document.getElementById('dayText').textContent,
        sub: document.getElementById('subText').textContent,
      },
      footVer: (document.querySelector('.foot-ver') || {}).textContent || '',
      body: document.body.innerText,
    };
  })()`);
}

const failures = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
};

async function readPanel() {
  return js(`(() => {
    const panel = document.getElementById('settingsPanel');
    if (!panel || panel.hidden) return { hidden: true, overflow: [] };
    const pr = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const left = pr.left + (parseFloat(cs.paddingLeft) || 0);
    const right = pr.right - (parseFloat(cs.paddingRight) || 0);
    const overflow = [];
    panel.querySelectorAll('button, select, .swatches, .switch, input[type="range"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      if (r.right > right + 0.5 || r.left < left - 0.5) {
        overflow.push({
          id: el.id,
          cls: String(el.className || '').slice(0, 30),
          left: Math.round(r.left),
          right: Math.round(r.right),
          leftLimit: Math.round(left),
          rightLimit: Math.round(right),
          text: (el.textContent || '').trim().slice(0, 24),
        });
      }
    });
    return { hidden: false, w: Math.round(pr.width), h: Math.round(pr.height), overflow };
  })()`);
}

async function setLang(lang) {
  const applied = await js(`(() => {
    const sel = document.getElementById('spLang');
    sel.value = ${JSON.stringify(lang)};
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return sel.value;
  })()`);
  await wait(260);
  return applied;
}

async function openPanel(on) {
  await js(`(() => {
    const p = document.getElementById('settingsPanel');
    if (${on} !== !p.hidden) document.getElementById('btnSettings').click();
    return !p.hidden;
  })()`);
  await wait(120);
}

const watchdog = setTimeout(() => {
  console.error('SMOKE TIMEOUT');
  app.exit(3);
}, 120000);

app.whenReady().then(async () => {
  win = new BrowserWindow({
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

  win.webContents.on('console-message', (_e, level, message) => {
    const m = String(message);
    if (m.includes('[wallpaper]') || m.includes('[opt]')) console.log('RENDERER ' + m);
  });

  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await wait(500);

  const report = { shots: [], langs: {}, notified };
  // 标题基准 = 首次渲染后的值（首启会把全角括号规范化一次，这是既有行为，与语言无关）
  let baselineTitles = null;

  for (const lang of ['zh-CN', 'zh-TW', 'en']) {
    const applied = await setLang(lang);
    check(applied === lang, `切到 ${lang} 后 select 值不对: ${applied}`);
    check(settings.lang === lang, `${lang}: settings:save 没收到 lang（实际 ${settings.lang}）`);

    const listView = await readUI();
    check(listView.lang === lang, `${lang}: <html lang> = ${listView.lang}`);
    check(listView.i18nLang === lang, `${lang}: i18n.getLang() = ${listView.i18nLang}`);
    check(listView.footVer.includes('v0.1.2-smoke'), `${lang}: 底部版本号没显示: ${listView.footVer}`);

    // —— 核心约束：切语言不碰用户标题（逐条按 id 比对）——
    const gotMap = Object.fromEntries(listView.titles.map((t) => [t.id, t.title]));
    if (!baselineTitles) baselineTitles = { ...gotMap };
    for (const id of Object.keys(baselineTitles)) {
      check(
        gotMap[id] === baselineTitles[id],
        `${lang}: 任务 ${id} 标题被改动\n  切换前: ${baselineTitles[id]}\n  切换后: ${gotMap[id]}`
      );
    }

    // 只给 data-i18n（写 textContent）的节点扣子元素；图标按钮只挂 data-i18n-title，不该动它
    for (const node of listView.staticNodes) {
      if (!node.hasText) continue;
      check(node.children === 0, `${lang}: [${node.key}] 用 data-i18n 写了文本却还有子元素，图标会被洗掉`);
    }

    // 页面里不能再出现占位符原样（{n} 之类）
    check(!/\{[a-zA-Z]+\}/.test(listView.body), `${lang}: 界面出现未替换的占位符`);

    report.langs[lang] = {
      header: listView.header,
      titles: listView.titles,
      overflow: listView.overflow,
      staticCount: listView.staticNodes.length,
      bodyLength: listView.body.length,
    };

    // 截图：列表 / 设置 / 编辑器 / 迷你条
    report.shots.push(await shot(`${lang}-1-list`));

    await openPanel(true);
    const panel = await readPanel();
    check(panel.hidden === false, `${lang}: 设置面板没打开`);
    for (const o of panel.overflow || []) {
      failures.push(
        `${lang}: 设置面板内容超出内边距 ${o.id || o.cls}（${o.left}..${o.right} 上限 ${o.leftLimit}..${o.rightLimit}）${o.text}`
      );
    }
    report.shots.push(await shot(`${lang}-2-settings`));
    await openPanel(false);

    await js(`document.getElementById('btnPick').click()`);
    await wait(150);
    report.shots.push(await shot(`${lang}-3-editor`));
    await js(`document.getElementById('edCancel').click()`);
    await wait(100);

    win.setContentSize(384, 72);
    await js(`document.getElementById('btnHide').click()`);
    await wait(200);
    report.shots.push(await shot(`${lang}-4-mini`));
    await js(`document.getElementById('miniExpand').click()`);
    win.setContentSize(384, 600);
    await wait(150);
  }

  // —— 重启后沿用上次语言（settings:load 里带着 en）——
  await setLang('en');
  check(settings.lang === 'en', '重启前没有把 en 写回设置');
  await win.reload();
  await wait(600);
  const afterReload = await readUI();
  check(afterReload.lang === 'en', `重启后语言没沿用: ${afterReload.lang}`);
  check(afterReload.header.sub !== '载入中' && afterReload.header.sub !== '', '重启后首屏文案没跟随语言');
  for (const t of afterReload.titles) {
    check(t.title === baselineTitles[t.id], `重启后任务 ${t.id} 标题被改动: ${t.title}`);
  }
  report.reload = { lang: afterReload.lang, header: afterReload.header, titles: afterReload.titles };

  // 切回中文，确认可逆
  await setLang('zh-CN');
  await wait(200);
  const back = await readUI();
  check(back.lang === 'zh-CN', '切回中文失败');
  for (const t of back.titles) {
    check(t.title === baselineTitles[t.id], `切回中文后任务 ${t.id} 标题被改动: ${t.title}`);
  }
  report.back = { lang: back.lang, header: back.header };

  /* ---------------- 导入 / 导出 UI ---------------- */
  const readToast = () =>
    js(`(() => {
      const t = document.getElementById('toast');
      return { hidden: t.hidden, text: t.textContent, shown: t.classList.contains('show') };
    })()`);

  await openPanel(true);
  await js(`document.getElementById('btnExport').click()`);
  await wait(200);
  const toastExport = await readToast();
  check(toastExport.hidden === false && toastExport.shown, '导出后没有弹出提示');
  check(toastExport.text === '已导出 6 条任务', `导出提示文案不对: ${toastExport.text}`);
  const panelAfterExport = await js(`document.getElementById('settingsPanel').hidden`);
  check(panelAfterExport === true, '导出后设置面板应收起');

  await openPanel(true);
  await js(`document.getElementById('btnImport').click()`);
  await wait(250);
  const toastImport = await readToast();
  report.shots.push(await shot('zh-CN-5-toast'));
  check(toastImport.text.includes('已导入 1 条任务'), `导入提示缺少条数: ${toastImport.text}`);
  check(toastImport.text.includes('跳过 1 条重复'), `导入提示缺少跳过数: ${toastImport.text}`);
  const idsAfterImport = await js(`[...document.querySelectorAll('.task')].map((el) => el.dataset.id)`);
  check(idsAfterImport.includes('imp1'), '导入的新任务没有出现在列表里');
  const titlesAfterImport = await js(
    `Object.fromEntries([...document.querySelectorAll('.task')].map((el) => [el.dataset.id, el.querySelector('.title').textContent.replace(/\u{1F514}/gu, '').trim()]))`
  );
  for (const id of Object.keys(baselineTitles)) {
    check(titlesAfterImport[id] === baselineTitles[id], `导入后旧任务 ${id} 标题被改动`);
  }
  check(titlesAfterImport.imp1 === '导入进来的任务：别动我', `导入任务标题被改写: ${titlesAfterImport.imp1}`);
  report.importExport = { exportToast: toastExport.text, importToast: toastImport.text, importedTitle: titlesAfterImport.imp1 };

  /* ---------------- 键盘操作 ---------------- */
  const key = (k) =>
    js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  const focusedId = () =>
    js(`(() => { const el = document.querySelector('#list .task.kb-focus'); return el ? el.dataset.id : null; })()`);

  // 设置面板打开时，Delete/空格不能误删任务（先点中一条再试）
  await js(`document.querySelector('#list .task[data-id="imp1"]') && document.querySelector('#list .task[data-id="imp1"]').click()`);
  await openPanel(true);
  await key('Delete');
  check(
    await js(`!!document.querySelector('#list .task[data-id="imp1"]')`),
    '设置面板打开时 Delete 误删了任务'
  );
  await key('Escape');
  check(await js(`document.getElementById('settingsPanel').hidden`), 'Esc 没有关掉设置面板');
  // 再按一次 Esc：清掉键盘选中，让后面的 ↓ 从第一条重新开始
  await key('Escape');
  check((await focusedId()) === null, 'Esc 没有清掉键盘选中');

  // 列表是按分组（逾期/今天/明天/本周/更远）渲染的，DOM 顺序才是键盘顺序
  const domOrder = await js(`[...document.querySelectorAll('#list .task')].map((el) => el.dataset.id)`);
  await key('ArrowDown');
  check((await focusedId()) === domOrder[0], `↓ 选中的不是第一条（期望 ${domOrder[0]}，实际 ${await focusedId()}）`);
  report.shots.push(await shot('zh-CN-6-keyboard'));
  await key('ArrowDown');
  check((await focusedId()) === domOrder[1], `↓↓ 没有走到第二条（期望 ${domOrder[1]}，实际 ${await focusedId()}）`);
  await key('ArrowUp');
  check((await focusedId()) === domOrder[0], `↑ 没有回到第一条（实际 ${await focusedId()}）`);

  // 直接把焦点放到导入的任务上，测 Enter/Delete
  await js(`document.querySelector('#list .task[data-id="imp1"]').click()`);
  check((await focusedId()) === 'imp1', '点击任务没有同步键盘选中');

  await key('Enter');
  check(!(await js(`document.getElementById('editor').hidden`)), 'Enter 没有打开编辑器');
  const edValue = await js(`document.getElementById('edTitle').value`);
  check(edValue === '导入进来的任务：别动我', `编辑器没有带入选中任务: ${edValue}`);
  await key('Escape');
  check(await js(`document.getElementById('editor').hidden`), 'Esc 没有关闭编辑器');

  const nextAfterImp1 =
    domOrder[domOrder.indexOf('imp1') + 1] || domOrder[domOrder.indexOf('imp1') - 1] || null;
  await key('Delete');
  check(!(await js(`!!document.querySelector('#list .task[data-id="imp1"]')`)), 'Delete 没有删除任务');
  check(
    (await focusedId()) === nextAfterImp1,
    `删除后焦点应落到下一条（期望 ${nextAfterImp1}，实际 ${await focusedId()}）`
  );

  const spaceTarget = await focusedId();
  await key(' ');
  check(
    !(await js(`!!document.querySelector('#list .task[data-id="${spaceTarget}"]')`)),
    '空格没有把任务标记完成'
  );
  const lastSaved = savedLists[savedLists.length - 1] || [];
  const savedT1 = lastSaved.find((t) => t.id === spaceTarget);
  check(savedT1 && savedT1.done === true, '空格完成后保存的数据里没有标记 done');
  report.keyboard = {
    order: domOrder,
    firstFocus: domOrder[0],
    afterDelete: nextAfterImp1,
    spaceTarget,
    spaceToggled: savedT1 && savedT1.done === true,
  };

  /* ---------------- 背景裁切 ---------------- */
  await openPanel(true);
  await js(`document.getElementById('btnPickBg').click()`);
  await wait(500);
  check(!(await js(`document.getElementById('cropper').hidden`)), '选图后没有出现裁切面板');
  check(await js(`document.getElementById('settingsPanel').hidden`), '选图后设置面板应收起');

  const frameBox = await js(`(() => {
    const r = document.getElementById('cropFrame').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  check(frameBox.w > 100 && frameBox.h > 150, `裁切框尺寸不对: ${JSON.stringify(frameBox)}`);

  // 拖动 → 画面跟着移
  const leftBefore = await js(`parseFloat(document.getElementById('cropImg').style.left)`);
  await js(`(() => {
    const f = document.getElementById('cropFrame');
    const opts = { bubbles: true, pointerId: 1, clientX: ${frameBox.x}, clientY: ${frameBox.y} };
    f.dispatchEvent(new PointerEvent('pointerdown', opts));
    f.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: ${frameBox.x + 50} }));
    f.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: ${frameBox.x + 50} }));
  })()`);
  const leftAfter = await js(`parseFloat(document.getElementById('cropImg').style.left)`);
  check(Math.abs(leftAfter - leftBefore) > 5, `拖动没有移动画面（${leftBefore} -> ${leftAfter}）`);

  // 滚轮放大
  const wBefore = await js(`parseFloat(document.getElementById('cropImg').style.width)`);
  await js(`document.getElementById('cropFrame').dispatchEvent(new WheelEvent('wheel', { deltaY: -260, clientX: ${frameBox.x}, clientY: ${frameBox.y}, bubbles: true, cancelable: true }))`);
  const wAfter = await js(`parseFloat(document.getElementById('cropImg').style.width)`);
  check(wAfter > wBefore + 5, `滚轮没有放大（${wBefore} -> ${wAfter}）`);

  // 浓度 50%
  await js(`(() => { const el = document.getElementById('cropFade'); el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  report.shots.push(await shot('zh-CN-7-cropper'));

  await js(`document.getElementById('cropApply').click()`);
  await wait(400);
  check(settings.bg === bgFiles[0], '确定后没有保存背景图');
  check(settings.bgCrop && settings.bgCrop.zoom > 1, '没有保存缩放值');
  check(Math.abs(settings.bgFade - 0.5) < 0.001, `没有保存浓度: ${settings.bgFade}`);
  const appliedBg = settings.bg;
  const appliedCrop = JSON.parse(JSON.stringify(settings.bgCrop || {}));
  const appliedFade = settings.bgFade;
  const bgApplied = await js(`(() => {
    const img = document.getElementById('bgImg');
    const card = document.getElementById('card');
    return {
      hidden: document.getElementById('bgLayer').hidden,
      imgW: Math.round(parseFloat(img.style.width)),
      cardW: card.clientWidth,
      veil: getComputedStyle(document.getElementById('bgVeil')).opacity,
    };
  })()`);
  check(!bgApplied.hidden, '背景层没有显示');
  check(bgApplied.imgW > bgApplied.cardW, `背景图没有铺满: ${bgApplied.imgW} vs ${bgApplied.cardW}`);
  check(Math.abs(Number(bgApplied.veil) - 0.5) < 0.01, `浓度没有生效: ${bgApplied.veil}`);
  report.shots.push(await shot('zh-CN-8-background'));

  // 取消裁切：临时图要被删掉，原背景不变
  await openPanel(true);
  await js(`document.getElementById('btnPickBg').click()`);
  await wait(400);
  check(!(await js(`document.getElementById('cropper').hidden`)), '第二次选图没有出现裁切面板');
  await js(`document.getElementById('cropCancel').click()`);
  await wait(200);
  check(discarded.includes(bgFiles[1]), '取消裁切没有删除临时图');
  check(settings.bg === bgFiles[0], '取消裁切改动了原背景');

  // 清除背景
  await js(`document.getElementById('btnClearBg').click()`);
  await wait(250);
  check(settings.bg === null, '清除背景没有写回设置');
  check(await js(`document.getElementById('bgLayer').hidden`), '清除后背景层还在');
  check(discarded.includes(bgFiles[0]), '清除背景没有删掉图片文件');

  report.background = {
    applied: appliedBg,
    cropZoom: appliedCrop ? appliedCrop.zoom : null,
    fade: appliedFade,
    discarded: discarded.length,
  };

  /* ---------------- 页脚自定义 ---------------- */
  await openPanel(true);
  const longText = 'DeskNote · 今天也要把论文写完鸭，然后去跑步，再回来改第三章的实验部分 (๑•̀ㅂ•́)و✧';
  await js(`(() => {
    const el = document.getElementById('spFootText');
    el.value = ${JSON.stringify(longText)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(1200);
  const footText = await js(`document.querySelector('.foot-ver').textContent`);
  check(footText === longText, `页脚文案没生效: ${footText}`);
  check(settings.footer && settings.footer.text === longText, '页脚文案没写回设置');

  await js(`(() => {
    const el = document.getElementById('spFootFont');
    el.value = 'Georgia,serif';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(1200);
  const fontFamily = await js(`getComputedStyle(document.querySelector('.foot-ver')).fontFamily`);
  check(/Georgia/i.test(fontFamily), `字体没生效: ${fontFamily}`);

  await js(`(() => {
    const el = document.getElementById('spFootItalic');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(1200);
  const footStyle = await js(`(() => {
    const s = getComputedStyle(document.querySelector('.foot-ver'));
    return { fontStyle: s.fontStyle, fontWeight: s.fontWeight, fontSize: s.fontSize };
  })()`);
  check(footStyle.fontStyle === 'italic', `斜体没生效: ${footStyle.fontStyle}`);
  check(Number(footStyle.fontWeight) >= 600, `默认没有加粗: ${footStyle.fontWeight}`);
  check(footStyle.fontSize === '10.5px', `字号没按设计固定: ${footStyle.fontSize}`);

  const foot = await js(`(() => {
    const f = document.querySelector('.foot');
    const v = getComputedStyle(document.documentElement).getPropertyValue('--foot-h');
    const p = document.getElementById('settingsPanel');
    return { h: Math.round(f.getBoundingClientRect().height), varH: v.trim(), panelBottom: getComputedStyle(p).bottom };
  })()`);
  check(foot.h > 39, `长文案没有把底栏撑高: ${foot.h}`);
  check(foot.varH === `${foot.h}px`, `--foot-h 没跟随底栏高度: ${foot.varH} vs ${foot.h}`);
  const panelBottomPx = parseFloat(foot.panelBottom);
  check(Math.abs(panelBottomPx - (foot.h - 1)) < 1.5, `设置面板没有跟着上移: bottom=${foot.panelBottom} foot=${foot.h}`);

  await js(`(() => {
    const el = document.getElementById('spFootText');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(1200);
  const backText = await js(`document.querySelector('.foot-ver').textContent`);
  check(backText.includes('DeskNote v0.1.2-smoke'), `留空没有回到版本号: ${backText}`);
  report.footer = { text: longText, font: fontFamily, style: footStyle, footH: foot.h, back: backText };

  /* ---------------- 壁纸穿透插件 + 互斥 ---------------- */
  const pluginCode = fs.readFileSync(path.join(ROOT, 'plugins', 'wallpaper', 'index.js'), 'utf8');
  await js(`window.__deskPluginFlags = {};`);
  await win.webContents.executeJavaScript(pluginCode);
  await wait(300);
  check(
    !(await js(`document.body.classList.contains('desktop-wallpaper')`)),
    '插件未启用时不应挂载'
  );

  await openPanel(true);
  await js(`document.getElementById('btnPlugins').click()`);
  await wait(400);
  const pmRow = await js(`(() => {
    const it = document.querySelector('#pmList .pm-item');
    if (!it) return null;
    const main = it.querySelector('.pm-main');
    return {
      trash: !!it.querySelector('.pm-trash'),
      order: main ? [...main.children].map((e) => e.className || e.tagName) : [],
      checked: it.querySelector('input[type=checkbox]') ? it.querySelector('input[type=checkbox]').checked : null,
    };
  })()`);
  check(pmRow && pmRow.trash, '插件管理里没有垃圾桶图标');
  check(
    pmRow && pmRow.order[0] === 'pm-body' && pmRow.order[1] === 'pm-trash' && pmRow.order[2].includes('switch'),
    `右侧顺序应是 垃圾桶→开关: ${pmRow && pmRow.order}`
  );
  check(pmRow && pmRow.checked === false, '插件默认应关闭');
  report.shots.push(await shot('zh-CN-10-plugins'));

  // 打开展示：立即挂载 + 背景按钮禁用
  await js(`document.querySelector('#pmList .pm-item input[type=checkbox]').click()`);
  await wait(1500);
  const wp = await js(`(() => {
    const layer = document.getElementById('pluginLayer');
    const img = layer.querySelector('.wallpaper-img');
    return {
      hidden: layer.hidden,
      bodyClass: document.body.classList.contains('desktop-wallpaper'),
      imgW: img ? Math.round(parseFloat(img.style.width)) : 0,
      bgDisabled: document.getElementById('btnPickBg').disabled,
    };
  })()`);
  check(!wp.hidden, '插件没有显示背景层');
  check(wp.bodyClass, '插件没有切到壁纸模式');
  check(wp.imgW > 0, `壁纸图没有铺开: ${wp.imgW}`);
  check(wp.bgDisabled, '壁纸开启时自定义背景按钮应禁用');
  const imgLoaded = await js(`(() => {
    const img = document.querySelector('#pluginLayer .wallpaper-img');
    return img ? { src: img.getAttribute('src') || '', complete: img.complete, nw: img.naturalWidth } : null;
  })()`);
  check(imgLoaded && imgLoaded.src, '壁纸图片没有设置 src');
  check(imgLoaded && imgLoaded.complete && imgLoaded.nw > 0, `壁纸图片没有解码成功: ${JSON.stringify(imgLoaded)}`);

  await js(`document.getElementById('pmClose').click()`);
  await wait(300);
  report.shots.push(await shot('zh-CN-9-wallpaper'));

  // 重新打开管理器再关闭插件
  await js(`document.getElementById('btnPlugins').click()`);
  await wait(300);

  // 关闭：卸载 + 背景按钮恢复
  await js(`document.querySelector('#pmList .pm-item input[type=checkbox]').click()`);
  await wait(400);
  check(await js(`document.getElementById('pluginLayer').hidden`), '关闭插件后背景层没有隐藏');
  check(!(await js(`document.getElementById('btnPickBg').disabled`)), '关闭插件后背景按钮没有恢复');

  // 打开“屏幕取景”：冒烟环境没有真实捕获，应自动回退，层仍可见
  await openPanel(true);
  await js(`document.getElementById('btnPlugins').click()`);
  await wait(300);
  const capBox = await js(`(() => {
    const it = document.querySelector('#pmList .pm-item');
    const el = it && it.querySelector('input[data-opt="wallpaperCapture"]');
    if (!el) return null;
    el.click();
    return true;
  })()`);
  check(capBox === true, '插件管理里没有屏幕取景选项');
  await wait(2500);
  check(!(await js(`document.getElementById('pluginLayer').hidden`)), '切换取景后背景层消失了');
  check(
    (await js(`!!document.querySelector('#pluginLayer .wallpaper-img, #pluginLayer .wallpaper-video')`)),
    '切换取景后没有回退到静态壁纸'
  );

  // 读 Wallpaper Engine 项目：预览图应换成 twin-tail
  await js(`document.querySelector('input[data-opt="wallpaperEngine"]').click()`);
  await wait(1800);
  const engSrc = await js(`(() => { const i = document.querySelector('#pluginLayer .wallpaper-img'); return i ? i.getAttribute('src') : ''; })()`);
  check(String(engSrc).includes('twin-tail'), `没有切到 WE 项目预览: ${engSrc}`);

  await js(`document.getElementById('pmClose').click()`);
  await openPanel(false);
  report.plugin = wp;

  // 存回主进程的任务标题也不能被翻译
  for (const list of savedLists) {
    for (const t of list) {
      if (baselineTitles[t.id]) check(t.title === baselineTitles[t.id], `state:save 里的标题被改动: ${t.title}`);
    }
  }
  report.savedLists = savedLists.length;

  // 溢出汇总：被裁剪才算失败，可见溢出只提示
  const overflowAll = Object.entries(report.langs).flatMap(([lang, v]) =>
    (v.overflow || []).map(
      (o) => ({ lang, ...o, text: `${lang}: ${o.tag}.${o.cls} [${o.scrollW}>${o.clientW}] ${o.text}` })
    )
  );
  for (const o of overflowAll) {
    if (o.clipped) failures.push(`${o.lang}: 文本被裁剪 ${o.cls || o.tag}: ${o.text}`);
  }

  report.failures = failures;
  report.overflow = overflowAll.map((o) => o.text);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('SHOTS:');
  for (const s of report.shots) console.log(`  ${path.basename(s.file)} ${s.size.width}x${s.size.height}`);
  console.log('\nHEADERS:');
  for (const [lang, v] of Object.entries(report.langs)) {
    console.log(`  ${lang}: ${v.header.day} | ${v.header.sub}`);
  }
  console.log(`\nstatic nodes per lang: ${JSON.stringify(Object.fromEntries(Object.entries(report.langs).map(([k, v]) => [k, v.staticCount])))}`);
  console.log(`\n导入/导出: ${JSON.stringify(report.importExport || {})}`);
  console.log(`键盘: ${JSON.stringify(report.keyboard || {})}`);
  console.log(`背景: ${JSON.stringify(report.background || {})}`);
  console.log(`页脚: ${JSON.stringify(report.footer || {})}`);
  console.log(`插件: ${JSON.stringify(report.plugin || {})}`);
  if (overflowAll.length) {
    console.log(`\n布局提示 ${overflowAll.length} 处（visible 溢出不算错）:`);
    for (const o of overflowAll) console.log(`  · ${o.clipped ? 'CLIP ' : 'spill '}${o.text}`);
  }
  if (failures.length) {
    console.log(`\n✗ 失败 ${failures.length} 条:`);
    for (const f of failures) console.log('  · ' + f);
  } else {
    console.log('\n✓ i18n 冒烟测试通过（标题跨语言逐字一致）');
  }

  clearTimeout(watchdog);
  await wait(200);
  app.exit(failures.length ? 1 : 0);
}).catch((err) => {
  console.error('SMOKE ERROR', err && err.stack ? err.stack : err);
  app.exit(4);
});

app.on('window-all-closed', () => app.quit());
