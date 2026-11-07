'use strict';

/* 插件宿主：主进程在页面加载后把已启用插件的代码注进来，
   插件调用 window.deskPluginHost.register({ id, mount(ctx) }) 挂载。 */

(function () {
  const flags = () => window.__deskPluginFlags || {};

  const api = {
    t: (key, params) => (window.i18n ? window.i18n.t(key, params) : key),
    enabled: (id) => !!flags()[id],
    layer: () => document.getElementById('pluginLayer'),
    saveSettings: (patch) => window.desk.saveSettings(patch),
    getWallpaper: () => window.desk.getWallpaper(),
    getDisplay: () => window.desk.getDisplay(),
    getCaptureSource: () => window.desk.getCaptureSource(),
    setContentProtection: (on) => window.desk.setContentProtection(on),
    getSettings: () => (typeof window.getDeskSettings === 'function' ? window.getDeskSettings() : {}),
    toast: (text, ms) => (typeof window.showToast === 'function' ? window.showToast(text, ms) : null),
  };

  const registered = new Map();
  const mounted = new Set();

  function activate(plugin) {
    if (mounted.has(plugin.id)) return;
    try {
      plugin.mount(api);
      mounted.add(plugin.id);
    } catch (err) {
      console.error('plugin mount failed:', plugin.id, err);
    }
  }

  function deactivate(plugin) {
    if (!mounted.has(plugin.id)) return;
    try {
      if (typeof plugin.unmount === 'function') plugin.unmount(api);
    } catch (err) {
      console.error('plugin unmount failed:', plugin.id, err);
    }
    mounted.delete(plugin.id);
  }

  window.deskPluginHost = {
    register(plugin) {
      if (!plugin || !plugin.id || typeof plugin.mount !== 'function') return;
      registered.set(plugin.id, plugin);
      if (flags()[plugin.id]) activate(plugin);
    },
    setEnabled(id, on) {
      const plugin = registered.get(id);
      if (!plugin) return false;
      if (on) activate(plugin);
      else deactivate(plugin);
      return true;
    },
    isMounted: (id) => mounted.has(id),
  };
})();
