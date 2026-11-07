'use strict';

/* ------------------------------------------------------------------
   多显示器用的纯几何函数（不依赖 Electron，可用 node 测）
   - 窗口允许跨屏，但必须保留一部分可见，避免"拖丢了找不到"
   - x 方向至少留 minX 像素，y 方向至少留 minY 像素
   ------------------------------------------------------------------ */

const round = (v) => Math.round(v);

function clampAxis(pos, size, start, end, minVisible) {
  const vis = Math.min(minVisible, size);
  const lo = start - (size - vis);
  const hi = end - vis;
  if (hi < lo) return round((start + end - size) / 2);
  return round(Math.min(Math.max(pos, lo), hi));
}

// bounds: {x, y, width, height}; area: {x, y, width, height}
function clampToArea(bounds, area, opts = {}) {
  const minX = Number.isFinite(opts.minX) ? opts.minX : 140;
  const minY = Number.isFinite(opts.minY) ? opts.minY : 80;
  const x = clampAxis(bounds.x, bounds.width, area.x, area.x + area.width, minX);
  const y = clampAxis(bounds.y, bounds.height, area.y, area.y + area.height, minY);
  return { x, y, changed: x !== round(bounds.x) || y !== round(bounds.y) };
}

// 计算 bounds 与 area 的重叠面积，用来判断"是不是已经看不见了"
function overlap(bounds, area) {
  const w = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const h = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return { w: Math.max(0, w), h: Math.max(0, h) };
}

module.exports = { clampToArea, overlap, clampAxis };
