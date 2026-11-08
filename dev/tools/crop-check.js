'use strict';

/* 背景裁切几何测试：node tools/crop-check.js */

const assert = require('node:assert');
const C = require('../../renderer/crop.js');

let n = 0;
const ok = (cond, msg) => {
  n++;
  assert.ok(cond, msg);
};
const close = (a, b, msg, eps = 0.001) => {
  n++;
  assert.ok(Math.abs(a - b) < eps, `${msg}（期望 ${b}，实际 ${a}）`);
};

const CW = 384;
const CH = 600;

/* 1. cover 基准：横图铺满宽 */
const wide = C.layout(CW, CH, 1600, 1000, { zoom: 1, x: 0, y: 0 });
const s0w = Math.max(CW / 1600, CH / 1000); // 0.6
close(wide.rw, 1600 * s0w, '横图渲染宽度');
close(wide.rh, 1000 * s0w, '横图渲染高度');
close(wide.left, (CW - wide.rw) / 2, '居中时水平居中');
ok(wide.maxY === 0, '高度方向恰好贴合，不能上下拖');

/* 2. 竖图铺满高 */
const tall = C.layout(CW, CH, 800, 1600, { zoom: 1, x: 0, y: 0 });
ok(tall.rw >= CW - 0.001 && tall.rh >= CH - 0.001, 'cover 至少铺满容器');
close(tall.maxX, 0, '竖图左右没有余量');

/* 3. x=±1 时贴边 */
const rightEdge = C.layout(CW, CH, 1600, 1000, { zoom: 1.6, x: 1, y: 0 });
close(rightEdge.left, CW - rightEdge.rw, 'x=1 显示图片最右侧');
const leftEdge = C.layout(CW, CH, 1600, 1000, { zoom: 1.6, x: -1, y: 0 });
close(leftEdge.left, 0, 'x=-1 显示图片最左侧');

/* 4. zoom 限制在 1–3 */
ok(C.normalize({ zoom: 0.2 }).zoom === 1, 'zoom 下限 1');
ok(C.normalize({ zoom: 9 }).zoom === 3, 'zoom 上限 3');
ok(C.normalize({ x: 3, y: -9 }).x === 1, 'x 被夹到 1');
ok(C.normalize({ x: 3, y: -9 }).y === -1, 'y 被夹到 -1');

/* 5. 拖动：向右拖，画面右移，x 变小 */
const panned = C.pan(CW, CH, 1600, 1000, { zoom: 2, x: 0, y: 0 }, 40, 0);
ok(panned.x < 0, '向右拖动后取景中心左移（x 变小）');
ok(panned.x >= -1, '不会越过边界');
const slammed = C.pan(CW, CH, 1600, 1000, { zoom: 2, x: 0, y: 0 }, 100000, 0);
ok(slammed.x === -1, '拖到尽头停在 -1');

/* 6. 拖动被上限拦住：zoom=1 时横图不能上下拖 */
const noPanY = C.pan(CW, CH, 1600, 1000, { zoom: 1, x: 0, y: 0 }, 0, 200);
ok(noPanY.y === 0, '没有余量时纵向拖动无效');

/* 7. 以左上角为锚点放大：锚点下的像素不动 */
const base = { zoom: 1, x: 0, y: 0 };
const before = C.layout(CW, CH, 1600, 1000, base);
const px = 120;
const py = 200;
const ix = (px - before.left) / before.rw;
const iy = (py - before.top) / before.rh;
const zoomed = C.zoomAt(CW, CH, 1600, 1000, base, px, py, 1.5);
const after = C.layout(CW, CH, 1600, 1000, zoomed);
close((px - after.left) / after.rw, ix, '放大后锚点横向位置不变');
close((py - after.top) / after.rh, iy, '放大后锚点纵向位置不变');

/* 8. 缩放上下限 */
ok(C.zoomAt(CW, CH, 1600, 1000, { zoom: 3, x: 0, y: 0 }, 100, 100, 2).zoom === 3, '不能超过 3 倍');
ok(C.zoomAt(CW, CH, 1600, 1000, { zoom: 1, x: 0, y: 0 }, 100, 100, 0.5).zoom === 1, '不能小于 1 倍');

/* 9. 归一化后与容器尺寸无关：同样的 crop 在 1.5 倍窗口里位置比例一致 */
const small = C.layout(384, 600, 1600, 1000, { zoom: 1.7, x: 0.3, y: -0.2 });
const big = C.layout(576, 900, 1600, 1000, { zoom: 1.7, x: 0.3, y: -0.2 });
close(small.left / (384 - small.rw), big.left / (576 - big.rw), '不同窗口尺寸下取景比例一致');

/* 10. 非法输入回落到默认值 */
const bad = C.normalize(null);
ok(bad.zoom === 1 && bad.x === 0 && bad.y === 0, '空 crop 回落到居中 1 倍');

console.log(`✓ 背景裁切几何测试通过（${n} 项断言）`);
