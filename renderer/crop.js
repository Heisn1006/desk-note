'use strict';

/* ------------------------------------------------------------------
   背景图裁切几何（渲染进程 + node 测试共用）
   - 基准：cover（图片铺满容器，至少一边贴合）
   - zoom：在 cover 基础上再放大 1–3 倍
   - x / y：取景中心，-1 = 看图片最左/最上，+1 = 最右/最下，0 = 居中
   - 所有比例都与容器尺寸无关，换缩放/换窗口大小不会跑偏
   ------------------------------------------------------------------ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.deskCrop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 3;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function normalize(crop) {
    const c = crop || {};
    return {
      zoom: clamp(Number(c.zoom) || 1, ZOOM_MIN, ZOOM_MAX),
      x: clamp(Number(c.x) || 0, -1, 1),
      y: clamp(Number(c.y) || 0, -1, 1),
    };
  }

  // 返回图片在容器里的尺寸与左上角位置（left/top 相对容器左上角）
  function layout(cw, ch, iw, ih, crop) {
    const c = normalize(crop);
    const s0 = Math.max(cw / iw, ch / ih);
    const rw = iw * s0 * c.zoom;
    const rh = ih * s0 * c.zoom;
    const left = (cw - rw) * ((c.x + 1) / 2);
    const top = (ch - rh) * ((c.y + 1) / 2);
    return { rw, rh, left, top, maxX: (rw - cw) / 2, maxY: (rh - ch) / 2 };
  }

  // 拖动 dx/dy（像素）后新的 crop；走到边缘会自然停住
  function pan(cw, ch, iw, ih, crop, dx, dy) {
    const l = layout(cw, ch, iw, ih, crop);
    const spanX = cw - l.rw;
    const spanY = ch - l.rh;
    let x = crop.x;
    let y = crop.y;
    if (spanX < -0.5) x = clamp(crop.x + (dx / spanX) * 2, -1, 1);
    else x = 0;
    if (spanY < -0.5) y = clamp(crop.y + (dy / spanY) * 2, -1, 1);
    else y = 0;
    return { zoom: crop.zoom, x, y };
  }

  // 以容器内某点 (px, py) 为锚点缩放，锚点下的图像保持不动
  function zoomAt(cw, ch, iw, ih, crop, px, py, factor) {
    const c = normalize(crop);
    const nextZoom = clamp(c.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    if (nextZoom === c.zoom) return c;

    const pre = layout(cw, ch, iw, ih, c);
    const ix = (px - pre.left) / pre.rw; // 0..1 图像横向位置
    const iy = (py - pre.top) / pre.rh;
    const next = normalize({ zoom: nextZoom, x: c.x, y: c.y });
    const post = layout(cw, ch, iw, ih, next);

    const left2 = px - ix * post.rw;
    const top2 = py - iy * post.rh;
    const spanX = cw - post.rw;
    const spanY = ch - post.rh;
    return {
      zoom: nextZoom,
      x: spanX < -0.5 ? clamp((left2 / spanX) * 2 - 1, -1, 1) : 0,
      y: spanY < -0.5 ? clamp((top2 / spanY) * 2 - 1, -1, 1) : 0,
    };
  }

  return { ZOOM_MIN, ZOOM_MAX, clamp, normalize, layout, pan, zoomAt };
});
