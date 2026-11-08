'use strict';

/* 时间规则测试：node tools/schedule-check.js
   重点回答：一个待办放一年不动，会发生什么？ */

const assert = require('node:assert');
const S = require('../../renderer/schedule.js');

let n = 0;
const ok = (cond, msg) => {
  n++;
  assert.ok(cond, msg);
};
const eq = (a, b, msg) => {
  n++;
  assert.strictEqual(a, b, `${msg}（实际 ${a}）`);
};
const day = (y, m, d, h = 9, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0);
const minus = (iso) => +new Date(iso);

/* ---------- 1. 一次性任务放一年：什么都不变 ---------- */

const once = {
  id: 'a',
  title: '论文初稿',
  done: false,
  due: '2026-11-07T18:00',
  hasTime: true,
  repeat: '',
  repeatDays: [],
};
const onceCopy = JSON.parse(JSON.stringify(once));
eq(S.rollTask(once, +day(2027, 11, 10)), false, '非重复任务不该被滚动');
eq(JSON.stringify(once), JSON.stringify(onceCopy), '一年后一次性任务的数据完全不变（不会复活到第二年）');
ok(+new Date(once.due) < +day(2027, 11, 10), '它仍然是一个过去的时刻，按「已逾期」显示');

/* ---------- 2. 每周任务放一年：落到「现在之后」的一次 ---------- */

const weekly = {
  id: 'b',
  title: '周报',
  done: false,
  due: '2026-11-09T18:00', // 2026-11-09 是周一
  hasTime: true,
  repeat: 'weekly',
  repeatDays: [1],
  startAt: '2026-11-07T09:00',
};
const now2 = +day(2027, 11, 10); // 2027-11-10 周三
eq(S.rollTask(weekly, now2), true, '每周任务一年后会被滚动');
eq(weekly.done, false, '保持未完成');
eq(weekly.due, '2027-11-15T18:00', '滚到 2027-11-15（周一），而不是停在 2026 的那天');
ok(+new Date(weekly.due) > now2, '滚动后一定在现在之后');
ok(+new Date(weekly.due) - now2 <= 7 * 86400000, '最多 7 天内');
eq(new Date(weekly.due).getHours(), 18, '时分保持不变');
eq(JSON.stringify(weekly.repeatDays), '[1]', '星期设置保持不变');
eq(weekly.startAt, '2027-11-13T09:00', '最迟开始时间随 due 同幅平移（相差仍是 2 天 9 小时）');

/* ---------- 3. 已完成 + nextAt 在一年前：先重置，再滚到本周 ---------- */

const doneWeekly = {
  id: 'c',
  title: '每周例检',
  done: true,
  doneAt: '2026-11-09T20:00:00.000Z',
  due: '2026-11-09T18:00',
  hasTime: true,
  repeat: 'weekly',
  repeatDays: [1],
  nextAt: '2026-11-16T18:00',
  nextStartAt: null,
  startAt: null,
};
eq(S.rollTask(doneWeekly, now2), true, '过期的 nextAt 会触发重置');
eq(doneWeekly.done, false, '重置为未完成');
eq(doneWeekly.nextAt, null, 'nextAt 清空');
eq(doneWeekly.due, '2027-11-15T18:00', '同一次调用里就滚到本周，而不是停在一年前的 nextAt');
ok(+new Date(doneWeekly.due) > now2, '重置后仍在现在之后');

/* ---------- 4. 跨年边界：2026-12-31 周四 -> 2027-01-07 周四 ---------- */

const yearEnd = {
  id: 'd',
  title: '跨年任务',
  done: false,
  due: '2026-12-31T08:00',
  hasTime: true,
  repeat: 'weekly',
  repeatDays: [4],
  startAt: null,
};
S.rollTask(yearEnd, +day(2027, 1, 2, 10)); // 2027-01-02 周六
eq(yearEnd.due, '2027-01-07T08:00', '跨年时按星期几 + 时分滚到 2027-01-07');
eq(new Date(yearEnd.due).getDay(), 4, '仍是周四');

/* ---------- 5. 闰年 2 月 29 日 ---------- */

const leap = {
  id: 'e',
  title: '闰日检查',
  done: false,
  due: '2027-02-27T20:00', // 周六
  hasTime: true,
  repeat: 'weekly',
  repeatDays: [6],
  startAt: null,
};
S.rollTask(leap, +day(2028, 2, 29, 12)); // 闰日当天（周二）
eq(new Date(leap.due).getDay(), 6, '闰日当天也仍落到周六');
ok(+new Date(leap.due) > +day(2028, 2, 29, 12), '落在闰日之后');
eq(new Date(leap.due).getHours(), 20, '时分不变');

/* ---------- 6. 当天但时间还没到：滚到今天 ---------- */

const sameDay = {
  id: 'f',
  title: '今晚',
  done: false,
  due: '2026-11-02T18:00',
  hasTime: true,
  repeat: 'weekly',
  repeatDays: [1],
  startAt: null,
};
const mondayMorning = +day(2026, 11, 9, 9); // 周一上午
S.rollTask(sameDay, mondayMorning);
eq(sameDay.due, '2026-11-09T18:00', '周一上午滚到当天 18:00，而不是下周一');

/* ---------- 7. 当天但时间已过：滚到下一周 ---------- */

const sameDayLate = {
  id: 'g',
  title: '今晚',
  done: false,
  due: '2026-11-02T18:00',
  hasTime: true,
  repeat: 'weekly',
  repeatDays: [1],
  startAt: null,
};
S.rollTask(sameDayLate, +day(2026, 11, 9, 19)); // 周一 19:00，18:00 已过
eq(sameDayLate.due, '2026-11-16T18:00', '周一晚上滚到下周一');

/* ---------- 8. 多选星期：取最近的一个 ---------- */

const multi = {
  id: 'h',
  title: '周一周五',
  done: false,
  due: '2026-11-02T07:30',
  hasTime: true,
  repeat: 'weekly',
  repeatDays: [1, 5],
  startAt: null,
};
S.rollTask(multi, +day(2027, 11, 10, 12)); // 周三中午
eq(new Date(multi.due).getDay(), 5, '周三之后最近的选中日是周五');
eq(multi.due, '2027-11-12T07:30', '落到 2027-11-12 周五 07:30');

/* ---------- 9. 不动的情况 ---------- */

const futureWeekly = {
  id: 'i',
  title: '还没到',
  done: false,
  due: '2027-11-20T18:00',
  hasTime: true,
  repeat: 'weekly',
  repeatDays: [6],
  startAt: null,
};
eq(S.rollTask(futureWeekly, now2), false, '未来的一次不动');
eq(futureWeekly.due, '2027-11-20T18:00', '未来时间保持原样');

const doneFuture = {
  id: 'j',
  title: '已完成，下次还没到',
  done: true,
  due: '2027-11-05T18:00',
  hasTime: true,
  repeat: 'weekly',
  repeatDays: [5],
  nextAt: '2027-11-19T18:00',
  startAt: null,
};
eq(S.rollTask(doneFuture, now2), false, 'nextAt 未到时保持完成状态');
eq(doneFuture.done, true, '不会被提前重置');

/* ---------- 10. rollAll 汇总 ---------- */

const batch = [
  { id: 'k', repeat: '', due: '2020-01-01T00:00', done: false },
  { id: 'l', repeat: 'weekly', repeatDays: [3], due: '2020-01-01T09:00', done: false },
  { id: 'm', repeat: 'weekly', repeatDays: [3], due: '2099-01-01T09:00', done: false },
];
eq(S.rollAll(batch, now2), true, 'rollAll 有改动时返回 true');
eq(batch.find((t) => t.id === 'k').due, '2020-01-01T00:00', '非重复任务不被 rollAll 碰');
ok(+new Date(batch.find((t) => t.id === 'l').due) > now2, '每周任务被推到未来');

/* ---------- 11. nextWeeklyTime 自身 ---------- */

const t1 = S.nextWeeklyTime(+day(2026, 11, 9, 9), [1], 18, 0);
eq(S.localISO(t1), '2026-11-09T18:00', '同一天 9:00 找周一 18:00 -> 当天');
const t2 = S.nextWeeklyTime(+day(2026, 11, 9, 19), [1], 18, 0);
eq(S.localISO(t2), '2026-11-16T18:00', '同一天 19:00 找周一 18:00 -> 下周一');

/* ---------- 12. 每月重复 ---------- */

// 每月 3/9/21 号：过期后滚到下一个命中日
const monthly = { repeat: 'monthly', monthDays: [3, 9, 21], due: '2026-11-03T18:00', done: false };
eq(S.rollTask(monthly, +day(2026, 11, 10)), true, '每月任务过期后会滚动');
eq(monthly.due, '2026-11-21T18:00', '每月 3/9/21：11-10 之后是 11-21');

// 还没到期时不动
const monthlyFuture = { repeat: 'monthly', monthDays: [3, 9, 21], due: '2026-11-21T18:00', done: false };
eq(S.rollTask(monthlyFuture, +day(2026, 11, 10)), false, '每月任务未到期不滚动');
eq(monthlyFuture.due, '2026-11-21T18:00', '未到期保持原时间');

// 30 号遇到 2 月：落到当月最后一天（不是跳过）
eq(
  S.localISO(S.nextMonthlyTime(+day(2026, 2, 1), [30], 18, 0)),
  '2026-02-28T18:00',
  '每月 30 号：2 月按 28 号提醒'
);

// 31 号遇到 4 月（30 天）
eq(
  S.localISO(S.nextMonthlyTime(+day(2026, 4, 1), [31], 18, 0)),
  '2026-04-30T18:00',
  '每月 31 号：4 月按 30 号提醒'
);

// 闰年 2 月
eq(
  S.localISO(S.nextMonthlyTime(+day(2028, 2, 1), [31], 18, 0)),
  '2028-02-29T18:00',
  '每月 31 号：闰年 2 月按 29 号提醒'
);

// 每月 1 号：跨月
eq(
  S.localISO(S.nextMonthlyTime(+day(2026, 11, 10), [1], 18, 0)),
  '2026-12-01T18:00',
  '每月 1 号：本月已过则下月'
);

// 已完成的每月任务到 nextAt 时重置，再继续滚
const monthlyDone = {
  repeat: 'monthly',
  monthDays: [5],
  due: '2026-10-05T09:00',
  done: true,
  nextAt: '2026-11-05T09:00',
};
eq(S.rollTask(monthlyDone, +day(2026, 11, 10)), true, '到期的每月任务会被重置');
eq(monthlyDone.done, false, '重置后回到未完成');
ok(+new Date(monthlyDone.due) > +day(2026, 11, 10), '重置后落到未来的一次');

/* ---------- 13. 每月重复：指定月份 ---------- */

// 只在 3/6/9/12 月的 5、20 号：1 月出发应落到 3 月 5 号
eq(
  S.localISO(S.nextMonthlyTime(+day(2026, 1, 10), [5, 20], 9, 0, [3, 6, 9, 12])),
  '2026-03-05T09:00',
  '指定月份：只在 3/6/9/12 月，1 月出发落到 3-05'
);

// 不选月份 = 每个月
eq(
  S.localISO(S.nextMonthlyTime(+day(2026, 1, 10), [3, 20], 9, 0, [])),
  '2026-01-20T09:00',
  '不选月份：每月都算，1-10 之后是 1-20'
);

// 只选 2 月 + 30 号：月末回落
eq(
  S.localISO(S.nextMonthlyTime(+day(2026, 1, 10), [30], 9, 0, [2])),
  '2026-02-28T09:00',
  '只选 2 月的 30 号：落到 2-28'
);

// 只选 12 月：要跨近一年才命中
ok(
  +new Date(S.localISO(S.nextMonthlyTime(+day(2026, 1, 10), [1], 9, 0, [12]))) > +day(2026, 11, 1),
  '只选 12 月：下一次在 12 月，跨了大半年'
);

// rollTask 会带上 monthlyMonths
const tMonths = { repeat: 'monthly', monthDays: [5], monthlyMonths: [12], due: '2026-01-05T09:00', done: false };
eq(S.rollTask(tMonths, +day(2026, 1, 10)), true, '指定月份的任务过期后会滚动');
eq(tMonths.due, '2026-12-05T09:00', '每月 12 月 5 号：滚到当年 12-05');

console.log(`✓ 时间规则测试通过（${n} 项断言）`);
console.log('  一年不动的一次性任务：数据不变，继续按“已逾期”显示；');
console.log('  一年不动的每周任务：落到“现在之后”的同星期时刻，不会回到去年。');
