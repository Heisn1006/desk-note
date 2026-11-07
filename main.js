'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, Notification, dialog, desktopCapturer, session, shell, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
// 与渲染进程共用同一份文案表（托盘、对话框这些系统 UI 也要跟着切语言）
const i18n = require('./renderer/i18n.js');
const taskData = require('./lib/data.js');
const backup = require('./lib/backup.js');
const geometry = require('./lib/geometry.js');

const HOTKEY = 'Control+Alt+N';
const HOTKEY_LABEL = 'Ctrl + Alt + N';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'DeskNote';
const DEFAULT_WIDTH = 384;
const DEFAULT_HEIGHT = 600;
const MINI_HEIGHT = 72;

const clampScale = (v) => Math.max(0.7, Math.min(1.6, Number(v) || 1));
const uiScale = () => clampScale(state && state.settings ? state.settings.uiScale : 1);
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
const winW = () => even(DEFAULT_WIDTH * uiScale());
const winH = () => even(DEFAULT_HEIGHT * uiScale());
const miniH = () => even(MINI_HEIGHT * uiScale());
const MAX_HEIGHT = 760;

let win = null;
let tray = null;
let quitting = false;
let openedHidden = process.argv.includes('--hidden');

// ------------------------------------------------------------------
// 数据目录（优先级从高到低）
//   1. DESKNOTE_DATA_DIR 环境变量（测试用）
//   2. 程序目录下的 DeskNoteData/     -> 升级 / 重装都不会覆盖它
//   3. 旧版本遗留的 data/             -> 自动复制到 DeskNoteData/ 后使用
//   4. %APPDATA%\DeskNote            -> 程序目录不可写时（如装在 Program Files）
// ------------------------------------------------------------------
function pickDataDir() {
  if (process.env.DESKNOTE_DATA_DIR) return process.env.DESKNOTE_DATA_DIR;

  const base = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  const target = path.join(base, 'DeskNoteData');
  const legacyList = [path.join(base, 'data'), path.join(base, '.data')];
  const legacy = legacyList.find((d) => fs.existsSync(d));

  const writable = (dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-probe');
      fs.writeFileSync(probe, '1');
      fs.unlinkSync(probe);
      return true;
    } catch {
      return false;
    }
  };

  try {
    if (fs.existsSync(target)) return target;
    if (fs.existsSync(legacy)) {
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(legacy)) {
        const from = path.join(legacy, name);
        if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(target, name));
      }
      return target;
    }
    if (writable(target)) return target;
  } catch (e) {
    console.error('data dir migrate failed', e);
  }

  const fallback = path.join(app.getPath('appData'), 'DeskNote');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

try {
  const dataDir = pickDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  app.setPath('userData', dataDir);
  console.log('[desk-note] data dir:', dataDir);
} catch (e) {
  console.error('setPath failed', e);
}

// 临时启动诊断（定位完可删）
// 打包后日志写到数据目录，绝不打进程序目录（否则会随安装包发出去）
const BOOT_LOG = app.isPackaged
  ? path.join(app.getPath('userData'), 'boot.log')
  : path.join(__dirname, 'boot.log');
const dbg = (m) => {
  try {
    fs.appendFileSync(BOOT_LOG, `${new Date().toISOString()} ${m}\n`);
  } catch {}
};
dbg('module loaded');
process.on('uncaughtException', (e) => dbg('uncaught: ' + (e && e.stack)));
process.on('unhandledRejection', (e) => dbg('rejection: ' + e));

/* ------------------------------------------------------------------ *
 * 本地状态
 * ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');
const localISO = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid = () => Math.random().toString(36).slice(2, 9);

function defaultSettings() {
  return {
    autostart: false,
    alwaysOnTop: true,
    opacity: 1,
    collapsed: false,
    bounds: null,
    lang: 'zh-CN',
    hideOnFullscreen: true,
    plugins: {},
  };
}

// 首次运行：给一个干净的空列表，不再塞演示任务
function seedState() {
  return {
    version: 2,
    tasks: [],
    settings: defaultSettings(),
  };
}

const statePath = () => path.join(app.getPath('userData'), 'state.json');

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (!raw || !Array.isArray(raw.tasks)) throw new Error('bad state');
    raw.settings = { ...defaultSettings(), ...(raw.settings || {}) };
    dbg('loadState -> tasks=' + raw.tasks.length);
    return raw;
  } catch (e) {
    dbg('loadState failed: ' + e);
    return seedState();
  }
}

const BACKUP_KEEP = 7;

// 每天第一次保存前留一份快照，只保留最近 BACKUP_KEEP 天（实现在 lib/backup.js）
function rotateBackup() {
  try {
    const r = backup.rotateBackup(statePath(), BACKUP_KEEP);
    if (r.created) dbg('backup created: ' + r.kept + ' kept');
    if (r.removed.length) dbg('backup pruned: ' + r.removed.join(','));
  } catch (e) {
    dbg('rotateBackup failed: ' + e);
  }
}

function saveState(tag) {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    rotateBackup();
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
    dbg('saveState[' + (tag || '?') + '] tasks=' + (state.tasks || []).length);
  } catch (err) {
    console.error('[desk-note] 保存失败', err);
  }
}

let state = null;

/* ------------------------------------------------------------------ *
 * 开机自启（HKCU Run 键，开发态与打包态都可用）
 * ------------------------------------------------------------------ */

function autostartCommand() {
  return app.isPackaged
    ? `"${process.execPath}" --hidden`
    : `"${process.execPath}" "${app.getAppPath()}" --hidden`;
}

const REG_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');

function isAutostart() {
  try {
    const out = execFileSync(REG_EXE, ['query', RUN_KEY, '/v', RUN_VALUE], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      windowsHide: true,
    }).toString();
    const ok = out.includes(RUN_VALUE);
    dbg('isAutostart -> ' + ok);
    return ok;
  } catch {
    return false;
  }
}

function setAutostart(on) {
  try {
    if (on) {
      // 值里带引号和空格，必须整串作为一个参数交给 reg add：
      // execFileSync 不经过 shell，不会被拆参（旧版写 .reg 再 reg import，
      // 文件是 UTF-16LE 但没有 BOM，reg.exe 读不了，自启一直是坏的）
      execFileSync(REG_EXE, ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', autostartCommand(), '/f'], {
        stdio: 'ignore',
        timeout: 5000,
        windowsHide: true,
      });
    } else {
      execFileSync(REG_EXE, ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], {
        stdio: 'ignore',
        timeout: 5000,
        windowsHide: true,
      });
    }
    const ok = isAutostart() === on;
    dbg('setAutostart(' + on + ') -> ' + ok);
    return ok;
  } catch (err) {
    dbg('setAutostart failed: ' + (err && err.message));
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 检查更新（读一个静态 version.json，不下载、不自动安装）
 * ------------------------------------------------------------------ */

const UPDATE_TIMEOUT = 15000;   // 本机到 GitHub 经常很慢，6 秒会把正常请求也打断

// 换成你自己的仓库地址即可；调试时可用环境变量覆盖成本地文件/服务
function updateManifestUrl() {
  return (
    process.env.DESKNOTE_UPDATE_URL ||
    'https://api.github.com/repos/Heisn1006/desk-note/contents/version.json'
  );
}

// 只比较数字段：1.2.10 > 1.2.9
function cmpVersion(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchManifest(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPDATE_TIMEOUT);
  try {
    if (/^https?:/i.test(url)) {
      // 走 GitHub 的 contents API：raw.githubusercontent.com 在很多网络下被重置，
      // api.github.com 通常可达；Accept: raw 让接口直接回文件内容
      const res = await net.fetch(url, {
        cache: 'no-store',
        signal: ctrl.signal,
        headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'DeskNote' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        // 没吃到 raw 时，内容 API 会包一层 { encoding: 'base64', content: '...' }
        const wrap = JSON.parse(text);
        if (wrap && wrap.encoding === 'base64' && wrap.content) {
          return JSON.parse(Buffer.from(wrap.content, 'base64').toString('utf8'));
        }
        throw new Error('manifest 不是 JSON');
      }
    }
    return JSON.parse(fs.readFileSync(url.replace(/^file:\/\//i, ''), 'utf8'));
  } finally {
    clearTimeout(timer);
  }
}

let lastUpdateCheckAt = 0;
const UPDATE_MIN_GAP = 30 * 60 * 1000;   // 自动检查最短间隔 30 分钟

// 打开便签 / 启动时顺手检查一次；离上次不足 30 分钟就跳过
async function autoCheckUpdate(reason) {
  if (!win || win.isDestroyed()) return false;
  // 页面还没就绪就先不查，交给启动后的定时器，否则 update:available 会发空
  if (win.webContents.isLoading()) return false;
  if (Date.now() - lastUpdateCheckAt < UPDATE_MIN_GAP) return false;
  const r = await checkUpdate(false);
  if (r && r.ok) lastUpdateCheckAt = Date.now();   // 只有成功才计入节流，失败下次还能再试
  dbg('update auto-check (' + reason + ') ok=' + !!(r && r.ok) + ' newer=' + !!(r && r.newer));
  if (r && r.ok && r.newer && win && !win.isDestroyed()) {
    try {
      win.webContents.send('update:available', r);
      dbg('update: notify renderer ' + r.latest);
    } catch {}
  }
  return !!(r && r.ok && r.newer);
}

async function checkUpdate(manual) {
  const current = app.getVersion();
  const url = updateManifestUrl();
  try {
    const j = await fetchManifest(url);
    const latest = String((j && j.version) || '').trim();
    if (!latest) throw new Error('manifest 缺少 version');
    const newer = cmpVersion(latest, current) > 0;
    dbg(`update: cur=${current} latest=${latest} newer=${newer} manual=${manual}`);
    return {
      ok: true,
      current,
      latest,
      newer,
      url: String((j && j.url) || ''),
      notes: String((j && j.notes) || ''),
    };
  } catch (err) {
    const msg = (err && err.message) || String(err);
    const timeout = /abort/i.test(msg);
    dbg('update check failed (' + (timeout ? 'timeout' : 'error') + '): ' + msg);
    return { ok: false, current, reason: timeout ? 'timeout' : 'error', error: msg };
  }
}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */

function defaultBounds(display) {
  const area = (display || screen.getPrimaryDisplay()).workArea;
  // 默认出现在屏幕右侧靠上（不是左下角；左下角只用于设置弹层定位）
  return { x: area.x + area.width - winW() - 56, y: area.y + 64 };
}

// 保存的 bounds 属于哪块屏：优先 displayId（还在就沿用），否则按坐标就近匹配
function displayForBounds(saved) {
  if (saved && saved.displayId != null) {
    const byId = screen.getAllDisplays().find((d) => d.id === saved.displayId);
    if (byId) return byId;
  }
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const m = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: winW(), height: winH() });
    if (m) return m;
  }
  return screen.getPrimaryDisplay();
}

/* ---------------- 全屏检测 ---------------- */

let fullscreenProc = null;
let hiddenByFullscreen = false;

// 屏幕取景：Electron 官方推荐走 getDisplayMedia，由主进程挑显示器
function setupDisplayMedia() {
  try {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        if (!sources.length) {
          dbg('displayMedia: no sources');
          return callback({});
        }
        const d = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
        const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
        dbg('displayMedia source: ' + src.name + ' display=' + d.id);
        callback({ video: src });
      } catch (e) {
        dbg('displayMedia handler failed: ' + e);
        callback({});
      }
    });
    dbg('displayMedia handler ready');
  } catch (e) {
    dbg('setDisplayMediaRequestHandler failed: ' + e);
  }
}

function startFullscreenWatcher() {
  const exe = path.join(__dirname, 'bin', 'fullscreen-watch.exe');
  if (!fs.existsSync(exe)) {
    dbg('fullscreen watcher missing');
    return;
  }
  try {
    fullscreenProc = spawn(exe, [String(process.pid)], { windowsHide: true });
    let buf = '';
    fullscreenProc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === '1' || line === '0') onFullscreen(line === '1');
      }
    });
    fullscreenProc.on('error', (e) => dbg('fullscreen watcher error: ' + e));
    fullscreenProc.on('exit', (c) => dbg('fullscreen watcher exit ' + c));
    dbg('fullscreen watcher started');
  } catch (e) {
    dbg('fullscreen watcher spawn failed: ' + e);
  }
}

function onFullscreen(on) {
  if (!win || win.isDestroyed()) return;
  dbg('fullscreen=' + on);
  if (on) {
    if (!state.settings.hideOnFullscreen) return;
    if (win.isVisible()) {
      hiddenByFullscreen = true;
      win.hide();
      refreshTrayMenu();
    }
  } else if (hiddenByFullscreen) {
    hiddenByFullscreen = false;
    win.showInactive();
    refreshTrayMenu();
  }
}

/* ---------------- 插件 ---------------- */

const PLUGIN_DIR = path.join(__dirname, 'plugins');

function listPlugins() {
  const out = [];
  try {
    for (const dir of fs.readdirSync(PLUGIN_DIR)) {
      const manifest = path.join(PLUGIN_DIR, dir, 'plugin.json');
      if (!fs.existsSync(manifest)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (!m || !m.id) continue;
        out.push({
          id: String(m.id),
          name: String(m.name || m.id),
          description: String(m.description || ''),
          version: String(m.version || ''),
          main: String(m.main || 'index.js'),
          dir,
        });
      } catch (e) {
        dbg('plugin manifest bad: ' + manifest + ' ' + e);
      }
    }
  } catch (e) {
    dbg('plugin scan failed: ' + e);
  }
  return out;
}

async function runEnabledPlugins() {
  try {
    if (!win || win.isDestroyed()) return;
    const enabled = state.settings.plugins || {};
    await win.webContents.executeJavaScript(
      `window.__deskPluginFlags = ${JSON.stringify(enabled)};`
    );
    for (const p of listPlugins()) {
      const file = path.join(PLUGIN_DIR, p.dir, p.main);
      if (!fs.existsSync(file)) continue;
      const code = fs.readFileSync(file, 'utf8');
      await win.webContents.executeJavaScript(code + `\n//# sourceURL=plugin:${p.id}`);
      dbg('plugin loaded: ' + p.id);
    }
  } catch (e) {
    dbg('plugins load failed: ' + e);
  }
}

// 换屏 / 拔屏 / 改缩放后把窗口拉回可见区
function ensureOnScreen(reason) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b);
  const c = geometry.clampToArea(b, d.workArea, { minX: 140, minY: 80 });
  if (!c.changed) return;
  dbg(`ensureOnScreen(${reason || ''}) ${JSON.stringify({ x: b.x, y: b.y })} -> ${JSON.stringify({ x: c.x, y: c.y })}`);
  programmatic = true;
  win.setBounds({ x: c.x, y: c.y, width: b.width, height: b.height });
  setTimeout(() => {
    programmatic = false;
  }, 300);
  state.settings.bounds = { x: c.x, y: c.y, displayId: d.id };
  saveState('display');
}

function createWindow() {
  const saved = state.settings.bounds;
  const hasSaved = !!(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y));
  const display = displayForBounds(hasSaved ? saved : null);
  const area = display.workArea;
  const pos = hasSaved ? saved : defaultBounds(display);
  // 允许跨屏，但至少留 140×80 可见，避免换屏后找不到
  const clamped = geometry.clampToArea({ x: pos.x, y: pos.y, width: winW(), height: winH() }, area, {
    minX: 140,
    minY: 80,
  });
  const x = clamped.x;
  const y = clamped.y;
  if (hasSaved && (clamped.changed || display.id !== saved.displayId)) {
    state.settings.bounds = { x, y, displayId: display.id };
    // 记录窗口现在归属哪块屏，下次换屏/拔屏时好判断
    saveState('bounds');
  }

  win = new BrowserWindow({
    width: winW(),
    height: winH(),
    x: Math.round(x),
    y: Math.round(y),
    minWidth: 120,
    minHeight: 1,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'DeskNote',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.setAlwaysOnTop(!!state.settings.alwaysOnTop, 'screen-saver');
  win.setOpacity(state.settings.opacity ?? 1);
  // --edit-demo 仅用于截图自查：启动时直接展开编辑器
  const hashArg = process.argv.find((a) => a.startsWith('--hash='));
  const hash = hashArg ? hashArg.slice(7) : process.argv.includes('--edit-demo') ? 'edit' : '';
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), hash ? { hash } : undefined);

  win.once('ready-to-show', () => {
    if (!openedHidden) win.showInactive();
  });

  // 兜底：某些环境 ready-to-show 不触发
  setTimeout(() => {
    try {
      if (!openedHidden && !win.isVisible()) {
        win.showInactive();
        dbg('showInactive fallback used');
      }
      if (!openedHidden) win.moveTop();
      dbg('visible=' + win.isVisible());
    } catch (e) {
      dbg('show fallback failed: ' + e);
    }
  }, 1500);

  win.webContents.on('console-message', (_e, level, message) => {
    const m = String(message || '');
    if (m.includes('[wallpaper]') || m.includes('[capture]')) dbg('renderer: ' + m);
  });

  win.webContents.on('did-finish-load', () => {
    runEnabledPlugins();
  });

  win.webContents.on('did-finish-load', async () => {
    try {
      const vp = await win.webContents.executeJavaScript(`(() => {
        const p = document.getElementById('settingsPanel');
        const r = p ? p.getBoundingClientRect() : null;
        const cs = p ? getComputedStyle(p) : null;
        return {
          w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
          panel: r ? { top: Math.round(r.top), h: Math.round(r.height), pos: cs.position, parent: p.parentElement.id } : null,
          cardH: Math.round(document.getElementById('card').getBoundingClientRect().height),
          mini: (() => {
            const b = document.getElementById('miniExpand');
            const bar = document.getElementById('miniBar');
            if (!b || !bar) return null;
            const rb = b.getBoundingClientRect();
            const rbar = bar.getBoundingClientRect();
            return { btn: [Math.round(rb.left), Math.round(rb.top), Math.round(rb.width), Math.round(rb.height)],
                     bar: [Math.round(rbar.left), Math.round(rbar.width)],
                     display: getComputedStyle(b).display, bodyMini: document.body.classList.contains('mini') };
          })(),
        };
      })()`);
      dbg('probe ' + JSON.stringify(vp));
      setTimeout(async () => {
        try {
          const late = await win.webContents.executeJavaScript(`(() => {
            const card0 = document.getElementById('card').getBoundingClientRect();
            // 模拟：选择“每周”，检查星期行是否出现
            const sel = document.getElementById('edRepeat');
            const edOpen = document.getElementById('editor');
            if (sel && edOpen && !edOpen.hidden) {
              sel.value = 'weekly';
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const edWrap = document.getElementById('editor');
            const repRow = document.getElementById('repeatDaysRow');
            if (edWrap) {
              const er = edWrap.getBoundingClientRect();
              const rr = repRow ? repRow.getBoundingClientRect() : null;
              window.__ed = {
                editor: [Math.round(er.left), Math.round(er.top), Math.round(er.width), Math.round(er.height)],
                rowW: Math.round((document.querySelector('.ed-row') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
                inputs: ['edDueDate', 'edDueHour', 'edDueMin'].map((id) => {
                  const el = document.getElementById(id);
                  if (!el) return null;
                  const r = el.getBoundingClientRect();
                  return [id, Math.round(r.width), Math.round(r.height), getComputedStyle(el).fontSize];
                }),
                editorHidden: edWrap.hidden,
                repRowHidden: repRow ? repRow.hidden : null,
                repRowH: rr ? Math.round(rr.height) : null,
                cardH: Math.round(document.getElementById('card').getBoundingClientRect().height),
              };
            }
            const row = document.querySelector('.task');
            if (row) {
              const body = row.querySelector('.body');
              const meta = row.querySelector('.meta');
              const lst = document.getElementById('list');
              window.__w = {
                card: Math.round(document.getElementById('card').getBoundingClientRect().width),
                list: Math.round(lst.getBoundingClientRect().width),
                listScroll: lst.scrollWidth,
                row: Math.round(row.getBoundingClientRect().width),
                body: Math.round(body.getBoundingClientRect().width),
                meta: Math.round(meta.getBoundingClientRect().width),
                metaScroll: meta.scrollWidth,
                metaStyle: getComputedStyle(meta).display + '/' + getComputedStyle(meta).overflow,
              };
            }
            const ft = document.querySelector('.foot');
            window.__foot = ft ? (() => { const r = ft.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), disp: getComputedStyle(ft).display, gear: !!document.getElementById('btnSettings') }; })() : null;
            const hb = document.getElementById('btnHide');
            if (hb) {
              const br = hb.getBoundingClientRect();
              const sr = hb.querySelector('svg').getBoundingClientRect();
              window.__icon = {
                btn: [Math.round(br.left * 10) / 10, Math.round(br.top * 10) / 10, Math.round(br.width * 10) / 10, Math.round(br.height * 10) / 10],
                svg: [Math.round(sr.left * 10) / 10, Math.round(sr.top * 10) / 10, Math.round(sr.width * 10) / 10, Math.round(sr.height * 10) / 10],
                dx: Math.round((sr.left + sr.width / 2 - br.left - br.width / 2) * 100) / 100,
                dy: Math.round((sr.top + sr.height / 2 - br.top - br.height / 2) * 100) / 100,
              };
            }
            const mb = document.getElementById('miniBar');
            if (mb) {
              const cr = document.getElementById('card').getBoundingClientRect();
              window.__mini = [...mb.children].map((el) => {
                const r = el.getBoundingClientRect();
                return { cls: el.className || el.id, cy: Math.round(r.top + r.height / 2 - cr.top), h: Math.round(r.height) };
              });
              window.__miniCardH = Math.round(cr.height);
            }
            const pnl = document.getElementById('settingsPanel');
            window.__pnl = pnl ? { w: Math.round(pnl.getBoundingClientRect().width), h: Math.round(pnl.getBoundingClientRect().height), hidden: pnl.hidden } : null;
            const hide = document.getElementById('btnHide').getBoundingClientRect();
            const mini = document.getElementById('miniExpand').getBoundingClientRect();
            const gap = (r) => r.width ? { right: Math.round(card0.right - r.right), top: Math.round(r.top - card0.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
            window.__gaps = { hide: gap(hide), mini: gap(mini) };
            const b = document.getElementById('miniExpand');
            const rb = b.getBoundingClientRect();
            const bar = document.getElementById('miniBar').getBoundingClientRect();
            const card = document.getElementById('card').getBoundingClientRect();
            return { ed: window.__ed, w: window.__w, foot: window.__foot, icon: window.__icon, mini: window.__mini, miniCardH: window.__miniCardH, panel: window.__pnl, gaps: window.__gaps, bodyMini: document.body.classList.contains('mini'),
                     btn: [Math.round(rb.left), Math.round(rb.top), Math.round(rb.width), Math.round(rb.height)],
                     bar: [Math.round(bar.left), Math.round(bar.width)],
                     card: [Math.round(card.left), Math.round(card.width), Math.round(card.height)] };
          })()`);
          dbg('lateProbe ' + JSON.stringify(late));
        } catch (e) {
          dbg('lateProbe failed ' + e);
        }
      }, 3000);
    } catch (e) {
      dbg('viewport probe failed: ' + e);
    }
  });

  let moveTimer = null;
  win.on('moved', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (programmatic) return;
      const b = win.getBounds();
      const d = screen.getDisplayMatching(b);
      state.settings.bounds = { x: Math.round(b.x), y: Math.round(b.y), displayId: d.id };
      saveState();
    }, 220);
  });

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
      refreshTrayMenu();
    }
  });

  win.on('hide', () => {
    refreshTrayMenu();
    // 首次隐藏时提示图标在托盘
    if (!state.settings.trayHintShown) {
      state.settings.trayHintShown = true;
      saveState('tray-hint');
      try {
        tray?.displayBalloon({
          title: i18n.t('tray.balloonTitle'),
          content: i18n.t('tray.balloonBody'),
          iconType: 'info',
        });
      } catch (e) {
        dbg('balloon failed: ' + e);
      }
    }
  });
  win.on('show', () => {
    refreshTrayMenu();
    // 点开便签时顺手检查更新（30 分钟内不重复）
    autoCheckUpdate('show');
  });
}

/* ------------------------------------------------------------------ *
 * 贴顶自动收起（类 QQ 早期行为）
 * ------------------------------------------------------------------ */

const DOCK_EDGE = 10;      // 距离屏幕顶部多少像素算“贴顶”
const DOCK_STRIP = 6;      // 收起后露出的高度
let docked = false;
let dockedExpanded = true;
let dockCooldownUntil = 0;
let miniActive = false;
let dockHeight = 600;
let collapseTimer = null;
let programmatic = false;

function setBoundsQuiet(rect) {
  programmatic = true;
  win.setBounds(rect);
  setTimeout(() => {
    programmatic = false;
  }, 150);
}


let heightAnim = null;
let rollToken = 0;

// 收起/展开：内容用 clip-path 在合成层动画（跟随刷新率），结束后再一次性改窗口尺寸
function canonicalBounds(height) {
  const b = (state.settings && state.settings.bounds) || {};
  return {
    x: Number.isFinite(b.x) ? Math.round(b.x) : win.getBounds().x,
    y: Number.isFinite(b.y) ? Math.round(b.y) : win.getBounds().y,
    width: winW(),
    height: Math.round(height),
  };
}

function rollTo(collapsed, done) {
  if (!win || win.isDestroyed()) return;
  // 动画期间 + 之后 700ms 内不再响应悬停，避免“刚收起又展开”的抖动
  dockCooldownUntil = Date.now() + 700;
  miniActive = collapsed;          // 统一在这里维护迷你态，缩放时据此决定高度
  const token = ++rollToken;
  const targetH = collapsed ? miniH() : winH();

  if (!collapsed) {
    // 展开：先把窗口放到最终高度（此时内容被裁着，看不到变化）
    programmatic = true;
    win.setBounds(canonicalBounds(targetH));
    setTimeout(() => {
      programmatic = false;
    }, 60);
  }

  try {
    win.webContents.send('roll:animate', { mode: collapsed ? 'collapse' : 'expand' });
  } catch {}

  clearTimeout(heightAnim);
  heightAnim = setTimeout(() => {
    if (token !== rollToken) return;   // 已有更新的动画，丢弃这次收尾
    if (!win || win.isDestroyed()) return;
    // 先让页面切到迷你/展开布局并清 clip，再改窗口尺寸：
    // 反过来的话会有一帧「窗口已缩小、卡片还是全高」，就是文字缺半截的来源
    try {
      win.webContents.send('roll:settle', { mini: collapsed });
    } catch {}
    programmatic = true;
    win.setBounds(canonicalBounds(targetH));
    setTimeout(() => {
      programmatic = false;
    }, 60);
    if (done) done();
  }, 230);
}

function handleDockMove() {
  if (!win || programmatic) return;
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;

  if (b.y <= area.y + DOCK_EDGE) {
    if (!docked) dbg('dock: attached');
    docked = true;
    dockedExpanded = true;
    if (b.height > 60) dockHeight = b.height;
    setBoundsQuiet({ x: b.x, y: area.y, width: b.width, height: Math.max(dockHeight, 60) });
  } else if (docked && b.y > area.y + 70) {
    docked = false;
    dbg('dock: detached');
    if (b.height <= DOCK_STRIP + 2) {
      setBoundsQuiet({ x: b.x, y: area.y + 80, width: b.width, height: dockHeight });
    }
  }
}

function startDockWatcher() {
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;


    // 贴顶检测（不依赖 moved 事件）
    if (!programmatic) {
      if (!docked && b.y >= area.y - 30 && b.y <= area.y + DOCK_EDGE) {
        docked = true;
        dockedExpanded = true;

        dbg('dock: attached');
        programmatic = true;
        win.setBounds({ x: b.x, y: area.y, width: b.width, height: winH() });
        setTimeout(() => {
          programmatic = false;
        }, 200);
        return;
      }
      if (docked && b.y > area.y + 70) {
        docked = false;
        dbg('dock: detached');
        if (b.height <= DOCK_STRIP + 2) {
          setBoundsQuiet({ x: b.x, y: area.y + 80, width: b.width, height: dockHeight });
        }
        return;
      }
    }
    if (!docked) return;
    if (Date.now() < dockCooldownUntil) return;

    const p = screen.getCursorScreenPoint();
    const hover =
      p.x >= b.x - 4 &&
      p.x <= b.x + b.width + 4 &&
      p.y >= area.y - 4 &&
      p.y <= b.y + b.height + 4;

    if (dockedExpanded) {
      if (hover) {
        if (collapseTimer) {
          clearTimeout(collapseTimer);
          collapseTimer = null;
        }
        return;
      }
      if (!collapseTimer) {
        collapseTimer = setTimeout(() => {
          collapseTimer = null;
          if (!docked || !win) return;
          const cur = win.getBounds();
          dockHeight = cur.height;
          dockedExpanded = false;
          rollTo(true, () => { miniActive = true; win && win.webContents.send('mini:state', true); });
          dbg('dock: collapsed');
        }, 450);
      }
    } else if (hover) {
      dockedExpanded = true;
      miniActive = false;
      win.webContents.send('mini:state', false);
      rollTo(false, null);
      dbg('dock: expanded by hover');
    }
  }, 120);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
  refreshTrayMenu();
}

/* ------------------------------------------------------------------ *
 * 托盘
 * ------------------------------------------------------------------ */

const ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAE0ElEQVR4nLVX22+URRT/nZn5vrJul1YKhCboYiqUUpCYBoMmBt+sUZQYNWKMFxJjvPAomkAEI/+AJpr4YEjURIm8+SYaeUICNpFbaakpXioYFWQL28t+38wxZ77dZd0uy+5WftnpttOZObffnDmHUIUnAf0lYEt/r1mzfJHWiq11hCZQ2tM/PJGrOE8B4OLwoIo9VByur+e2fm3Mc8x8P4A7/Xr+z9obgkk+fssfRDgKov2nRs4drFDEVSpQ+ub+ldk9ULRTK22YHbisa2sgkkH+HGa73+Xtq8MTE5dKSlCF213/quxHxpiX4tgyM1sikkVNWV6CJiBy3kwOCc4BpLXWztljMRUeGhk5L0pAbQKMxKhvZXa3Fx7FhURzMkUtqZWRi5lSmqjTkLpq2ViGdnFcUEpv0C78orhOeevWrsquZlInwewnW7W6BMvAs91teGxJiDYCDudifDAxg8mYYQiR1jqwsX3+9NjPn4gwcdM2rZQRv89HuLj9qmUvfEc2hcUBIa0JW5e1YdcdKVj2TFYQQYRXxFg1MDAQELDJC09i3hJEa4l5V6CwZUmIi5FDIeEALsw63NcRYH3GYNqyEvHE3N/bm73d5PMXFmoOevxkrYNrztZWQBAq8sNxEuDSvFi2QOZlSoQpldGxW22UUgx7LTFUC46iKLlL3FgIfp91OHw5xDPdKZyfSfLPooAwmrc4cTVGSlP5KCJywvQaVgPWWj+6urpE4QaJwUiTxocTk2hniweWpkHMGMlb7D03jSnLuEUn3imdZ2ofJBfX4Z3db2Fw88Ow01PQ6sb0cI6h2tpwZvQsXnv9DXz252VkQoMfr8SJ8GJoKmHmWk+Iohi3dnbi6a1PAGGnBKKJy+Fw7+IeDKzbh68OfodMJoOQULa8GqZ6QtwdhgZ//X0Ru3btxaOPb4GbmYJKUkYDHkjh9PHjOHzkKJZ2tAvjvOBawr3B8tpRpEdJqcWVeUA8MTU1jThuxnpvAkgppNPperuYiIgtP1iXhGEYoLt7GeRRKr5sNxAtwjWuTOYwMzOLMAy9R+vB1CPhnrffxODmR+Cm81CNkFBuS9CGn8bOYvv2HcjlcjDG1FXC3AwSbljSg7X9+/DNt4fQsTDjU3DDCnBTJPRJ7Zpo5xISnjiO748cRXt7GlYe4jqg+ZGQobXxyskNKC1jx0ilFtQL2/xJyCXC5XIoRNEcwok3GoFplYStEO76ClBFldoUCZsj3FwziY1zjjRrU45fJQl3vovNZRJWeaAFws3V3wW0cePy1OQlNaRJ9zkJdvJ0ewgJE69c/zVugHA1twGYVaTu8XavWbXiY6P1i3EcSyVc5kWjhzZKuKJkp4nIsh1JZX5d7yUQ8adJRURzDm5kNAVmq3xSUZ8PDSFS0hOcHv3lkLP2gAm00NiX5TcDzBxLRRw7ey4Vq/e9k6UhkV84sC9ba49pY0JmFtpLPcX/h9zk1rKU48Yx/0OwTw2Nj+fkn6VmEcPDE5dcPh501n1tjAmUUlLiUUUz2eogRaQCYwJmN8YOg6dGf/tBPF9uzYooN4zrerMvMGgbM99FpDrmaf4MmMdI4cBUQb03Pj6eq+zAq7NLuUmVH3f3rcgWGL0US2npu6aGIUlG0pwCXegdGT9T1aKXmfsvyCO0aPSAGAsAAAAASUVORK5CYII=';

function trayIcon() {
  // Windows 托盘优先用多尺寸 .ico（单图 png 在高 DPI 下常注册成空白）
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  let img = nativeImage.createFromPath(icoPath);
  dbg('tray ico: empty=' + img.isEmpty() + ' size=' + JSON.stringify(img.getSize()));
  if (!img.isEmpty()) return img;

  const p = path.join(__dirname, 'assets', 'icon.png');
  img = nativeImage.createFromPath(p);
  dbg('tray icon from file: empty=' + img.isEmpty() + ' path=' + p);
  if (img.isEmpty()) {
    img = nativeImage.createFromDataURL('data:image/png;base64,' + ICON_B64);
    dbg('tray icon from fallback: empty=' + img.isEmpty());
  }
  return img;   // 交给系统按 DPI 缩放（本机 150%，16px 会糊且可能不显示）
}

function refreshTrayMenu() {
  if (!tray) return;
  const visible = !!win && win.isVisible();
  tray.setToolTip(i18n.t('tray.tip', { hotkey: HOTKEY_LABEL }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: visible ? i18n.t('tray.hide') : i18n.t('tray.show'), click: toggleWindow },
      {
        label: i18n.t('tray.hotkey', {
          accel: String((state.settings && state.settings.hotkey) || HOTKEY)
            .split('+')
            .map((k) => (k === 'Control' ? 'Ctrl' : k))
            .join(' + '),
        }),
        enabled: false,
      },
      { type: 'separator' },
      {
        label: i18n.t('tray.autostart'),
        type: 'checkbox',
        checked: isAutostart(),
        click: (item) => {
          state.settings.autostart = item.checked;
          setAutostart(item.checked);
          saveState();
          win?.webContents.send('settings:changed', state.settings);
        },
      },
      {
        label: i18n.t('tray.alwaysOnTop'),
        type: 'checkbox',
        checked: !!state.settings.alwaysOnTop,
        click: (item) => {
          state.settings.alwaysOnTop = item.checked;
          win?.setAlwaysOnTop(item.checked, 'screen-saver');
          saveState();
          win?.webContents.send('settings:changed', state.settings);
        },
      },
      { type: 'separator' },
      {
        label: i18n.t('tray.quit'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
}

function createTray() {
  const img = trayIcon();
  if (img.isEmpty()) {
    dbg('tray icon empty, skip');
    return;
  }
  try {
    tray = new Tray(img);
    tray.setToolTip(i18n.t('tray.tip', { hotkey: HOTKEY_LABEL }));
    refreshTrayMenu();
    tray.on('click', toggleWindow);
    dbg('tray created, size=' + JSON.stringify(img.getSize()));
    // 有些环境首次注册不生效，1.5 秒后重设一次图标
    setTimeout(() => {
      try {
        tray.setImage(img);
        tray.setToolTip(i18n.t('tray.tip', { hotkey: HOTKEY_LABEL }));
        refreshTrayMenu();
        dbg('tray refreshed');
      } catch (e) {
        dbg('tray refresh failed: ' + e);
      }
    }, 1500);
  } catch (e) {
    dbg('tray create failed: ' + e);
  }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function applyHeight() {
  // 固定尺寸窗口，内部滚动；保留接口以便将来做自适应
  return;
}

// 只保留当前在用的背景图，避免 userData 里越攒越多
function cleanupBackgrounds(keepUrl) {
  try {
    const dir = app.getPath('userData');
    let keepName = '';
    if (typeof keepUrl === 'string' && keepUrl.startsWith('file:///')) {
      keepName = path.basename(path.normalize(decodeURIComponent(keepUrl.slice('file:///'.length))));
    }
    for (const name of fs.readdirSync(dir)) {
      if (!/^background[-.]/i.test(name)) continue;
      if (name === keepName) continue;
      if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) continue;
      try {
        fs.unlinkSync(path.join(dir, name));
        dbg('bg cleanup -> ' + name);
      } catch {}
    }
  } catch (err) {
    dbg('cleanupBackgrounds failed: ' + err);
  }
}

// 读 Wallpaper Engine 当前选中的壁纸项目（Steam 库 + config.json）
function pathFromWin(p) {
  return String(p || '').replace(/\//g, '\\');
}

function readWallpaperEngine() {
  try {
    const steam = pathFromWin(regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath') || process.env.SteamPath);
    if (!steam) return null;
    const cfg = path.join(steam, 'steamapps', 'common', 'wallpaper_engine', 'config.json');
    if (!fs.existsSync(cfg)) return null;
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    let wc = null;
    for (const k of Object.keys(j)) {
      const v = j[k];
      if (v && v.general && v.general.wallpaperconfig && v.general.wallpaperconfig.selectedwallpapers) {
        wc = v.general.wallpaperconfig;
        break;
      }
    }
    if (!wc) return null;
    const selected = wc.selectedwallpapers || {};
    const mon = selected.Monitor0 || selected[Object.keys(selected)[0]];
    if (!mon || !mon.file) return null;
    const file = pathFromWin(mon.file);
    if (!fs.existsSync(file)) return null;
    const dir = path.dirname(file);
    const ext = path.extname(file).toLowerCase();
    const preview = ['preview.jpg', 'preview.png', 'preview.jpeg', 'preview.gif']
      .map((n) => path.join(dir, n))
      .find((f) => fs.existsSync(f)) || '';
    const isVideo = ext === '.mp4' || ext === '.webm';
    dbg(`wallpaper engine: ${path.basename(file)} video=${isVideo} preview=${!!preview}`);
    return {
      file,
      dir,
      ext,
      preview,
      video: isVideo ? file : '',
      title: String(mon.title || ''),
      mtime: fs.statSync(file).mtimeMs,
    };
  } catch (e) {
    dbg('wallpaper engine read failed: ' + e);
    return null;
  }
}

function regValue(key, name) {
  try {
    const out = execFileSync(REG_EXE, ['query', key, '/v', name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    const m = out.match(/REG_(?:SZ|EXPAND_SZ)\s+([^\r\n]*)/i);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function registerIpc() {
  ipcMain.handle('state:load', () => state);

  ipcMain.handle('state:save', (_e, tasks) => {
    dbg('ipc state:save tasks=' + (Array.isArray(tasks) ? tasks.length : 'not-array'));
    if (Array.isArray(tasks)) {
      state.tasks = tasks;
      saveState('ipc');
    }
    return true;
  });

  ipcMain.handle('settings:save', (_e, patch) => {
    state.settings = { ...state.settings, ...(patch || {}) };

    if (patch && patch.uiScale != null && win) {
      const b = win.getBounds();
      const targetH = miniActive ? miniH() : winH();
      win.setBounds({ x: b.x, y: b.y, width: winW(), height: targetH });
      dbg('scale -> ' + uiScale() + ' mini=' + miniActive + ' => ' + winW() + 'x' + targetH);
    }

    if (typeof state.settings.opacity === 'number') win?.setOpacity(state.settings.opacity);
    if (typeof state.settings.alwaysOnTop === 'boolean') win?.setAlwaysOnTop(state.settings.alwaysOnTop, 'screen-saver');
    if (typeof state.settings.autostart === 'boolean') {
      // 系统项写入可能失败（受限环境），但设置值保持用户选择，避免开关弹回
      const ok = setAutostart(state.settings.autostart);
      dbg('settings autostart=' + state.settings.autostart + ' systemApplied=' + ok);
    }
    if (patch && patch.lang) {
      i18n.setLang(state.settings.lang);
      dbg('settings lang=' + state.settings.lang);
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'bg')) {
      cleanupBackgrounds(state.settings.bg);
    }
    saveState('settings');
    refreshTrayMenu();
    return state.settings;
  });

  ipcMain.handle('info:get', () => ({
    hotkey: HOTKEY_LABEL,
    statePath: statePath(),
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    updateUrl: updateManifestUrl(),
  }));

  ipcMain.handle('update:check', (_e, manual) => {
    if (manual) lastUpdateCheckAt = Date.now();
    return checkUpdate(!!manual);
  });

  ipcMain.handle('update:open', (_e, url) => {
    try {
      const u = new URL(String(url || ''));
      if (u.protocol !== 'https:') return false;
      shell.openExternal(u.toString());
      dbg('openExternal ' + u.toString());
      return true;
    } catch (err) {
      dbg('openExternal failed: ' + err);
      return false;
    }
  });

  ipcMain.handle('plugins:remove', (_e, id) => {
    try {
      const p = listPlugins().find((x) => x.id === id);
      if (!p) return { ok: false, reason: 'not-found' };
      const dir = path.join(PLUGIN_DIR, p.dir);
      if (!dir.startsWith(PLUGIN_DIR + path.sep)) return { ok: false, reason: 'bad-path' };
      fs.rmSync(dir, { recursive: true, force: true });
      const plugins = Object.assign({}, state.settings.plugins || {});
      delete plugins[id];
      state.settings.plugins = plugins;
      saveState('plugin-remove');
      dbg('plugin removed: ' + id);
      return { ok: true };
    } catch (e) {
      dbg('plugin remove failed: ' + e);
      return { ok: false, reason: String(e && e.message) };
    }
  });

  ipcMain.handle('plugins:list', () => {
    const enabled = state.settings.plugins || {};
    return listPlugins().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      enabled: !!enabled[p.id],
    }));
  });

  ipcMain.handle('wallpaper:get', () => {
    const key = 'HKCU\\Control Panel\\Desktop';
    let pathValue = (regValue(key, 'WallPaper') || '').replace(/^"|"$/g, '').trim();
    const style = Number(regValue(key, 'WallpaperStyle') || 10) || 10;
    const tile = regValue(key, 'TileWallpaper') === '1';
    let mtime = 0;
    if (pathValue) {
      try {
        mtime = fs.statSync(pathValue).mtimeMs;
      } catch {
        // 注册表里有路径但文件不存在（动态壁纸/壁纸软件常见），当作没读到
        dbg('wallpaper path missing: ' + pathValue);
        pathValue = '';
      }
    }
    return { path: pathValue, style, tile, mtime };
  });

  ipcMain.handle('we:info', () => readWallpaperEngine());

  ipcMain.handle('capture:source', async () => {
    try {
      if (!win) return null;
      const d = screen.getDisplayMatching(win.getBounds());
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources || !sources.length) return null;
      const match = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
      dbg('capture source: ' + match.name + ' display=' + d.id);
      return { id: match.id, name: match.name, displayId: d.id };
    } catch (e) {
      dbg('capture source failed: ' + e);
      return null;
    }
  });

  ipcMain.handle('capture:protect', (_e, on) => {
    try {
      if (!win || win.isDestroyed()) return false;
      win.setContentProtection(!!on);
      dbg('contentProtection=' + !!on);
      return true;
    } catch (e) {
      dbg('contentProtection failed: ' + e);
      return false;
    }
  });

  ipcMain.handle('display:info', () => {
    if (!win || win.isDestroyed()) return null;
    const d = screen.getDisplayMatching(win.getBounds());
    return { bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor };
  });

  ipcMain.on('ui:height', (_e, h) => applyHeight(h));

  ipcMain.on('notify', (_e, payload) => {
    try {
      if (!Notification.isSupported()) return;
      new Notification({
        title: (payload && payload.title) || 'DeskNote',
        body: (payload && payload.body) || '',
      }).show();
    } catch (err) {
      dbg('notify failed: ' + err);
    }
  });

  ipcMain.handle('hotkey:set', (_e, accel) => {
    if (typeof accel !== 'string' || !/^[A-Za-z0-9+]+$/.test(accel) || accel.split('+').length < 2) {
      return { ok: false, error: 'invalid' };
    }
    const old = (state.settings && state.settings.hotkey) || HOTKEY;
    try {
      globalShortcut.unregisterAll();
    try {
      fullscreenProc?.kill();
    } catch {}
    } catch {}
    let ok = false;
    try {
      ok = globalShortcut.register(accel, toggleWindow);
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        globalShortcut.register(old, toggleWindow);
      } catch {}
      return { ok: false, error: 'conflict', hotkey: old };
    }
    state.settings.hotkey = accel;
    saveState('hotkey');
    refreshTrayMenu();
    dbg('hotkey -> ' + accel);
    return { ok: true, hotkey: accel };
  });

  ipcMain.on('win:mini', (_e, on) => {
    if (!win) return;
    dbg('mini toggle on=' + on + ' cur=' + JSON.stringify(win.getBounds()));
    if (on) {
      rollTo(true, () => { miniActive = true; win && win.webContents.send('mini:state', true); });
    } else {
      miniActive = false;
      win.webContents.send('mini:state', false);
      rollTo(false, null);
    }
  });

  ipcMain.on('win:hide', () => {
    win?.hide();
    refreshTrayMenu();
  });
  ipcMain.on('app:restart', () => {
    dbg('restart requested');
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(0);
  });

  ipcMain.handle('bg:pick', async () => {
    try {
      const res = await dialog.showOpenDialog(win, {
        title: i18n.t('dialog.bgTitle'),
        properties: ['openFile'],
        filters: [{ name: i18n.t('dialog.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
      const src = res.filePaths[0];
      const ext = path.extname(src).toLowerCase() || '.png';
      // 用带时间戳的文件名：取消裁切时直接删掉，不会把正在用的旧背景覆盖掉
      const d = new Date();
      const stamp =
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const dest = path.join(app.getPath('userData'), `background-${stamp}${ext}`);
      fs.copyFileSync(src, dest);
      dbg('bg picked -> ' + dest);
      return { url: 'file:///' + dest.replace(/\\/g, '/'), name: path.basename(dest) };
    } catch (err) {
      dbg('bg pick failed: ' + err);
      return null;
    }
  });

  // 取消裁切时删掉刚复制的临时图；只允许删 userData 下的 background-*
  ipcMain.handle('bg:discard', (_e, url) => {
    try {
      if (typeof url !== 'string' || !url.startsWith('file:///')) return false;
      const abs = path.normalize(decodeURIComponent(url.slice('file:///'.length)));
      const dir = app.getPath('userData');
      const base = path.basename(abs);
      if (path.dirname(abs).toLowerCase() !== dir.toLowerCase()) return false;
      if (!/^background[-.\w]+\.(png|jpe?g|webp|gif|bmp)$/i.test(base)) return false;
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
      dbg('bg discarded -> ' + base);
      return true;
    } catch (err) {
      dbg('bg discard failed: ' + err);
      return false;
    }
  });

  /* ---------------- 导入 / 导出 ---------------- */

  ipcMain.handle('data:export', async () => {
    try {
      const d = new Date();
      const stamp =
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `-${pad(d.getHours())}${pad(d.getMinutes())}`;
      const res = await dialog.showSaveDialog(win, {
        title: i18n.t('dialog.exportTitle'),
        defaultPath: path.join(app.getPath('documents'), `DeskNote-${stamp}.json`),
        filters: [{ name: i18n.t('dialog.jsonFilter'), extensions: ['json'] }],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      const payload = taskData.buildExport(state.tasks, app.getVersion());
      fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
      dbg(`export -> ${res.filePath} tasks=${payload.tasks.length}`);
      return { ok: true, count: payload.tasks.length, path: res.filePath };
    } catch (e) {
      dbg('export failed: ' + e);
      return { ok: false, reason: i18n.t('export.fail') };
    }
  });

  ipcMain.handle('data:import', async () => {
    try {
      const res = await dialog.showOpenDialog(win, {
        title: i18n.t('dialog.importTitle'),
        properties: ['openFile'],
        filters: [{ name: i18n.t('dialog.jsonFilter'), extensions: ['json'] }],
      });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
      const file = res.filePaths[0];
      const parsed = taskData.parseImport(fs.readFileSync(file, 'utf8'));
      if (!parsed.ok) {
        const reason =
          parsed.error === 'too-many'
            ? i18n.t('import.tooMany', { max: taskData.MAX_TASKS })
            : parsed.error === 'json'
              ? i18n.t('import.json')
              : i18n.t('import.bad');
        dbg('import rejected: ' + parsed.error);
        return { ok: false, reason };
      }

      const existing = Array.isArray(state.tasks) ? state.tasks : [];
      const preview = taskData.mergeTasks(existing, parsed.tasks);
      if (!preview.added) {
        dbg(`import <- ${file} 没有新任务（重复 ${preview.skipped}）`);
        return { ok: true, added: 0, skipped: preview.skipped, tasks: existing };
      }

      const confirm = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: [i18n.t('import.yes'), i18n.t('import.no')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: i18n.t('dialog.importTitle'),
        message: i18n.t('import.confirm', { n: preview.added }),
        detail: preview.skipped ? i18n.t('import.confirmSkip', { n: preview.skipped }) : '',
      });
      if (confirm.response !== 0) return { ok: false, canceled: true };

      state.tasks = preview.tasks;
      saveState('import');
      dbg(`import <- ${file} added=${preview.added} skipped=${preview.skipped}`);
      return { ok: true, added: preview.added, skipped: preview.skipped, tasks: state.tasks };
    } catch (e) {
      dbg('import failed: ' + e);
      return { ok: false, reason: i18n.t('import.fail') };
    }
  });

  ipcMain.on('win:quit', () => {
    quitting = true;
    app.quit();
  });
}

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 单实例（PID 锁文件；requestSingleInstanceLock 在本机环境会崩）
 * ------------------------------------------------------------------ */

const lockPath = () => path.join(app.getPath('userData'), 'instance.lock');

function acquireInstanceLock() {
  const file = lockPath();
  try {
    const pid = Number(String(fs.readFileSync(file, 'utf8')).trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0); // 还活着
        return false;
      } catch {
        /* 进程已退出，视为陈旧锁 */
      }
    }
  } catch {
    /* 没有锁文件 */
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(process.pid));
  } catch (e) {
    dbg('lock write failed: ' + e);
  }
  return true;
}

const gotLock = acquireInstanceLock();
dbg('instance lock -> ' + gotLock);
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    dbg('app ready');
    app.setAppUserModelId('com.desknote.widget');
    state = loadState();
    i18n.setLang(state.settings.lang || 'zh-CN');
    setupDisplayMedia();
    dbg('state loaded, tasks=' + state.tasks.length);

    registerIpc();
    startDockWatcher();

    if (process.argv.includes('--test-scale')) {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const setScale = (v) =>
        win.webContents.executeJavaScript(
          `(() => { const el = document.getElementById('spScale'); el.value = '${v}'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value; })()`
        );
      (async () => {
        await wait(1200);
        for (const v of [70, 100, 130, 160]) {
          const applied = await setScale(v);
          await wait(800);
          dbg(`SCALE ${v} (slider=${applied}) -> ${JSON.stringify(win.getBounds())} setting=${state.settings.uiScale}`);
        }
        // 越界输入（input 会被 min/max 夹住）
        const out = await setScale(220);
        await wait(800);
        dbg(`SCALE 220 -> slider=${out} bounds=${JSON.stringify(win.getBounds())} setting=${state.settings.uiScale}`);

        // 快速连续拖动
        for (const v of [120, 90, 150, 110]) {
          await setScale(v);
          await wait(90);
        }
        await wait(1000);
        dbg(`SCALE rapid final=${JSON.stringify(win.getBounds())} setting=${state.settings.uiScale}`);

        // 收起态改缩放
        rollTo(true, () => win.webContents.send('mini:state', true));
        await wait(500);
        dbg(`SCALE collapsed@110 = ${JSON.stringify(win.getBounds())}`);
        await setScale(140);
        await wait(800);
        dbg(`SCALE collapsed->140 = ${JSON.stringify(win.getBounds())} setting=${state.settings.uiScale} miniH=${miniH()}`);
        await setScale(100);
        await wait(800);
        dbg(`SCALE collapsed->100 = ${JSON.stringify(win.getBounds())} setting=${state.settings.uiScale} miniH=${miniH()}`);
        dbg('SCALETEST done');
      })();
    }

    if (process.argv.includes('--selftest')) {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      (async () => {
        await wait(800);
        // 缩放滑块端到端测试：模拟拖动滑块，看窗口是否真的变
        try {
          const before = JSON.stringify(win.getBounds());
          const r = await win.webContents.executeJavaScript(`(() => {
            const el = document.getElementById('spScale');
            if (!el) return 'no-slider';
            const panel = document.getElementById('settingsPanel');
            if (panel) panel.hidden = false;
            el.value = '140';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return el.value;
          })()`);
          await wait(900);
          dbg('SCALETEST slider=' + r + ' before=' + before + ' after=' + JSON.stringify(win.getBounds()));
          await win.webContents.executeJavaScript(`(() => {
            const el = document.getElementById('spScale');
            el.value = '100';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          })()`);
          await wait(900);
          dbg('SCALETEST restored=' + JSON.stringify(win.getBounds()));
        } catch (e) {
          dbg('SCALETEST failed ' + e);
        }

        // 迷你态对齐测量
        rollTo(true, null);
        await wait(500);
        try {
          const geo = await win.webContents.executeJavaScript(`(() => {
            const card = document.getElementById('card').getBoundingClientRect();
            const items = [];
            const walk = (el) => {
              const r = el.getBoundingClientRect();
              if (r.height > 0) items.push({ k: el.id || el.className, cy: Math.round((r.top + r.height / 2 - card.top) * 10) / 10, h: Math.round(r.height * 10) / 10 });
              [...el.children].forEach(walk);
            };
            [...document.getElementById('miniBar').children].forEach(walk);
            const cs = items;
            return { cardH: Math.round(card.height), centers: cs };
          })()`);
          dbg('MINIGEO ' + JSON.stringify(geo));
        } catch (e) {
          dbg('MINIGEO failed ' + e);
        }
        rollTo(false, null);
        await wait(400);

        // 快速连续切换（模拟狂点），检查是否越变越大
        state.settings.uiScale = 1;
        win.setBounds({ x: 200, y: 100, width: winW(), height: winH() });
        await wait(300);
        for (let i = 0; i < 10; i++) {
          rollTo(i % 2 === 0, null);
          await wait(90);   // 比动画短，制造打断
        }
        await wait(600);
        dbg('SELFTEST rapid :: ' + JSON.stringify(win.getBounds()));

        for (const sc of [0.8, 1.0, 1.25, 1.5]) {
          state.settings.uiScale = sc;
          win.setBounds({ x: 200, y: 100, width: winW(), height: winH() });
          await wait(400);
          const runs = [];
          for (let i = 0; i < 3; i++) {
            rollTo(true, null);
            await wait(320);
            runs.push(JSON.stringify(win.getBounds()));
            rollTo(false, null);
            await wait(320);
            runs.push(JSON.stringify(win.getBounds()));
          }
          dbg('SELFTEST scale=' + sc + ' expect=' + winW() + 'x' + winH() + ' mini=' + miniH() + ' :: ' + runs.join(' | '));
        }
        dbg('SELFTEST done');
      })();
    }

    if (process.argv.includes('--test-auto')) {
      dbg('TEST setAutostart(true) -> ' + setAutostart(true) + ' / cmd=' + autostartCommand());
    }

    createWindow();
    dbg('window created');

    // 启动后静默检查一次更新（失败只进日志，不打扰）
    setTimeout(() => autoCheckUpdate('startup'), 5000);

    startFullscreenWatcher();
    for (const ev of ['display-removed', 'display-added', 'display-metrics-changed']) {
      screen.on(ev, () => ensureOnScreen(ev));
    }
    createTray();
    dbg('tray created');

    // 自启同步放到窗口起来之后，避免注册表调用卡住启动
    setTimeout(() => {
      try {
        const actual = isAutostart();
        dbg('autostart check: settings=' + state.settings.autostart + ' actual=' + actual);
        // 只补写，不主动删除：避免误删用户已在别处配置的自启项
        if (state.settings.autostart && !actual) {
          const ok = setAutostart(true);
          dbg('autostart write -> ' + ok);
        }
      } catch (e) {
        dbg('autostart sync failed: ' + e);
      }
    }, 1500);

    const accel = (state.settings && state.settings.hotkey) || HOTKEY;
    const ok = globalShortcut.register(accel, toggleWindow);
    dbg('hotkey register ' + accel + ' -> ' + ok);
    dbg('hotkey registered: ' + ok);
    if (!ok) console.warn('[desk-note] 全局快捷键注册失败：', HOTKEY);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else win?.show();
    });
  });

  app.on('will-quit', () => {
    dbg('will-quit');
    globalShortcut.unregisterAll();
    try {
      fullscreenProc?.kill();
    } catch {}
    try {
      fs.unlinkSync(lockPath());
    } catch {
      /* ignore */
    }
  });

  app.on('window-all-closed', () => {
    // 托盘常驻，不退出
  });
}
