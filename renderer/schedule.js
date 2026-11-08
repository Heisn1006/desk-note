'use strict';

/* ------------------------------------------------------------------
   时间规则（渲染进程 + node 测试共用）
   核心约定：
   - 待办时间存的是「本地日期 + 时分」字符串，比如 2026-11-07T18:00
   - 它是一次性时刻，不会因为到了第二年的同一天而复活
   - 「每周重复」按选中的星期几向前滚动；「每月重复」按选中的几号向前滚动，
     总是找 now 之后最近、时分不变的那一次（每周最多看 14 天，每月最多看 62 天）
   - 已完成且到了 nextAt 的重复任务会先重置，再按上面的规则滚动；
     所以离线一年再打开，也只会落在「现在之后的一次」，不会停在去年
   ------------------------------------------------------------------ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.deskSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const pad = (n) => String(n).padStart(2, '0');
  const localISO = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // nowTs 之后最近的、落在 days（星期几）里的时刻；找不到返回 null
  function nextWeeklyTime(fromTs, days, hh, mm) {
    const base = new Date(fromTs);
    for (let i = 0; i <= 14; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, hh, mm, 0, 0);
      if (+d > fromTs && days.includes(d.getDay())) return d;
    }
    return null;
  }

  // 某年某月的天数（m 从 0 开始）
  const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();

  // nowTs 之后最近的、日期（几号）落在 daysOfMonth 里的时刻
  // months 为空 = 每个月都算；否则只在选中的月份里找（1-12）
  // 没有这一天的月份（2 月没有 30/31 号）按「当月最后一天」算，不会被跳过
  function nextMonthlyTime(fromTs, daysOfMonth, hh, mm, months) {
    const base = new Date(fromTs);
    const wanted = daysOfMonth.slice();
    const wantMonths = Array.isArray(months) && months.length ? months : null;
    for (let i = 0; i <= 400; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, hh, mm, 0, 0);
      if (+d <= fromTs) continue;
      if (wantMonths && wantMonths.indexOf(d.getMonth() + 1) < 0) continue;
      const last = lastDayOf(d.getFullYear(), d.getMonth());
      if (wanted.some((w) => Math.min(w, last) === d.getDate())) return d;
    }
    return null;
  }

  // 就地滚动一条任务；返回 true 表示改动了
  function rollTask(t, nowTs) {
    const mode = t && (t.repeat === 'weekly' || t.repeat === 'monthly') ? t.repeat : '';
    if (!mode) return false;

    let changed = false;

    // 1) 已完成且到了下一次的时间 -> 重置为未完成
    if (t.done && t.nextAt && nowTs >= +new Date(t.nextAt)) {
      t.done = false;
      t.doneAt = null;
      t.due = t.nextAt;
      if (t.nextStartAt) t.startAt = t.nextStartAt;
      t.nextAt = null;
      t.nextStartAt = null;
      changed = true;
      // 不直接返回：离线很久时 nextAt 可能已经过去一年，继续往下滚
    } else if (t.done) {
      return false;
    }

    if (!t.due) return changed;

    const due = new Date(t.due);
    if (!Number.isFinite(+due)) return changed;
    if (+due >= nowTs) return changed;

    // 2) 过期 -> 找 now 之后最近的一次
    const next =
      mode === 'weekly'
        ? nextWeeklyTime(
            nowTs,
            Array.isArray(t.repeatDays) && t.repeatDays.length ? t.repeatDays : [due.getDay()],
            due.getHours(),
            due.getMinutes()
          )
        : nextMonthlyTime(
            nowTs,
            Array.isArray(t.monthDays) && t.monthDays.length ? t.monthDays : [due.getDate()],
            due.getHours(),
            due.getMinutes(),
            t.monthlyMonths
          );
    if (!next) return changed;

    if (t.startAt) {
      const shift = +next - +due;
      t.startAt = localISO(new Date(+new Date(t.startAt) + shift));
    }
    t.due = localISO(next);
    return true;
  }

  function rollAll(tasks, nowTs) {
    let changed = false;
    for (const t of tasks || []) {
      if (rollTask(t, nowTs)) changed = true;
    }
    return changed;
  }

  return { nextWeeklyTime, nextMonthlyTime, rollTask, rollAll, localISO };
});
