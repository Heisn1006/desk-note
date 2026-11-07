'use strict';

/* 捕获自检：electron --no-sandbox tools/capture-test.js
   验证 Electron 45 下 getDisplayMedia + setDisplayMediaRequestHandler 能否拿到屏幕流 */

const { app, BrowserWindow, session, desktopCapturer, screen } = require('electron');
const path = require('node:path');

app.setPath('userData', path.join(__dirname, '..', '.testdata', 'capture-userdata'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        console.log('SOURCES', sources.length, sources.map((s) => s.name + '#' + s.display_id).join(','));
        callback({ video: sources[0] });
      } catch (e) {
        console.log('HANDLER_ERR', e && e.message);
        callback({});
      }
    });
  } catch (e) {
    console.log('SET_HANDLER_ERR', e && e.message);
  }

  const win = new BrowserWindow({
    width: 300,
    height: 200,
    x: -3000,
    y: -3000,
    show: true,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, '..', '.testdata', 'capture-page.html'));

  const result = await win.webContents.executeJavaScript(`(async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const t = s.getVideoTracks()[0];
      return { ok: true, label: t.label, settings: t.getSettings() };
    } catch (e) {
      return { ok: false, name: e.name, message: e.message };
    }
  })()`);
  console.log('GET_DISPLAY_MEDIA', JSON.stringify(result));

  const legacy = await win.webContents.executeJavaScript(`(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop' } } });
      return { ok: true, label: s.getVideoTracks()[0].label };
    } catch (e) {
      return { ok: false, name: e.name, message: e.message };
    }
  })()`);
  console.log('LEGACY_GETUSERMEDIA', JSON.stringify(legacy));

  await wait(200);
  app.exit(0);
});
