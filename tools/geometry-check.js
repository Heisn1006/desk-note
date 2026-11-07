'use strict';

/* 多显示器几何测试：node tools/geometry-check.js */

const assert = require('node:assert');
const g = require('../lib/geometry.js');

let n = 0;
const ok = (cond, msg) => {
  n++;
  assert.ok(cond, msg);
};
const eq = (a, b, msg) => {
  n++;
  assert.strictEqual(a, b, `${msg}（实际 ${a}）`);
};

const win = (x, y) => ({ x, y, width: 384, height: 600 });
const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const right = { x: 1920, y: 0, width: 2560, height: 1440 };
const left = { x: -1920, y: 0, width: 1920, height: 1080 };

/* 1. 完全在屏幕内：不动 */
const inside = g.clampToArea(win(400, 200), primary);
ok(!inside.changed && inside.x === 400 && inside.y === 200, '屏内位置不调整');

/* 2. 副屏在左边（负坐标）：不应被主屏规则拉回去 */
const leftScreen = g.clampToArea(win(-1500, 300), left);
ok(!leftScreen.changed && leftScreen.x === -1500, '左副屏的负坐标保持不变');

/* 3. 副屏被拔掉：窗口跑到 3000，回主屏后要拉回可见区 */
const removed = g.clampToArea(win(3000, 400), primary);
ok(removed.changed, '屏幕没了要拉回');
ok(removed.x <= 1920 - 140, `右侧至少留 140px 可见，实际 x=${removed.x}`);
eq(removed.x, 1780, '拉到 1780');

/* 4. 窗口整个跑到上方：y 方向至少留 80px */
const above = g.clampToArea(win(300, -700), primary);
ok(above.changed, '上方越界要拉回');
eq(above.y, -520, 'y 拉回 -520（600-80）');

/* 5. 窗口部分出屏但在允许范围：不动 */
const partial = g.clampToArea(win(1700, 700), primary);
ok(!partial.changed, '仍保留 140px 可见时不移动');

/* 6. 窗口比屏幕还大（极端缩放）：仍落在合法区间，可见部分铺满 */
const hugeBounds = { x: 0, y: 0, width: 3000, height: 2000 };
const huge = g.clampToArea(hugeBounds, primary);
ok(huge.x <= 1780 && huge.x >= -2860, `超宽窗口 x 在合法区间（实际 ${huge.x}）`);
eq(g.overlap({ ...hugeBounds, x: huge.x, y: huge.y }, primary).w, 1920, '超宽时水平方向仍然铺满可见区');

/* 7. 顶栏吸附场景：y 正好等于 workArea 顶部 */
const dockedTop = g.clampToArea(win(800, 0), primary);
ok(!dockedTop.changed && dockedTop.y === 0, '贴顶时 y=0 不被改动');

/* 8. overlap 计算 */
const ov = g.overlap(win(1800, 500), primary);
eq(ov.w, 120, '重叠宽度 120');
eq(ov.h, 580, '高度方向重叠 580（底部超出 20）');
eq(g.overlap(win(3000, 0), primary).w, 0, '完全在右侧时重叠为 0');

/* 9. 回到副屏：主屏拉回的结果放到右屏仍然合法 */
const backRight = g.clampToArea(win(2500, 300), right);
ok(!backRight.changed && backRight.x === 2500, '右副屏内位置保持不变');

/* 10. 四舍五入 */
const frac = g.clampToArea({ x: 100.6, y: 200.4, width: 384, height: 600 }, primary);
eq(frac.x, 101, 'x 四舍五入');
eq(frac.y, 200, 'y 四舍五入');

console.log(`✓ 多显示器几何测试通过（${n} 项断言）`);
