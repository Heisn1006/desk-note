'use strict';

/* ------------------------------------------------------------------
   时间规则（渲染进程 + node 测试共用）
   核心约定：
   - 待办时间存的是「本地日期 + 时分」字符串，比如 2026-11-07T18:00
   - 它是一次性时刻，不会因为到了第二年的同一天而复活
   - 「每天」按截止时间每天滚一次；「每周重复」按选中的星期几向前滚动；「每月重复」按选中的几号向前滚动，
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
    const mode =
      t && (t.repeat === 'weekly' || t.repeat === 'monthly' || t.repeat === 'daily') ? t.repeat : '';
    if (!mode) return false;

    let changed = false;

    // 0) 没有截止日期的「每天」任务：做完当天的，第二天自动复位成未完成
    if (t.repeat === 'daily' && !t.due && t.done) {
      const doneAt = t.doneAt ? new Date(t.doneAt) : null;
      const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (!doneAt || !Number.isFinite(+doneAt) || dayStart(doneAt) < dayStart(new Date(nowTs))) {
        t.done = false;
        t.doneAt = null;
        changed = true;
      }
      return changed;
    }

    // 1) 已完成且到了下一次的时间 -> 重置为未完成
    if (t.done && t.nextAt && nowTs >= +new Date(t.nextAt)) {
      t.done = false;
      t.doneAt = null;
      if (t.remindByRepeat) {
        // 截止日期是最后期限，不跟着重复滚；下一轮提醒由 nextAt 控制
        t.nextAt = null;
        t.nextStartAt = null;
        changed = true;
      } else {
        t.due = t.nextAt;
        if (t.nextStartAt) t.startAt = t.nextStartAt;
        t.nextAt = null;
        t.nextStartAt = null;
        changed = true;
      }
      // 不直接返回：离线很久时 nextAt 可能已经过去一年，继续往下滚
    } else if (t.done) {
      return false;
    }

    if (!t.due) return changed;

    // 「按重复日提前提醒」的截止日期是最后期限，不按重复节奏往后滚
    if (t.remindByRepeat) return changed;

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
        : mode === 'daily'
          ? nextWeeklyTime(nowTs, [0, 1, 2, 3, 4, 5, 6], due.getHours(), due.getMinutes())
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

  // "09:30" -> [9, 30]；不合法用默认值
  function parseHM(v, dflt) {
    const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return dflt;
    return [Math.min(23, +m[1]), Math.min(59, +m[2])];
  }

  // 今天是不是这条重复任务的「提醒日」（每周看星期几，每月看几号 + 月份过滤）
  function isRepeatDay(t, d) {
    if (t.repeat === 'weekly') {
      const days = Array.isArray(t.repeatDays) ? t.repeatDays : [];
      return days.length > 0 && days.includes(d.getDay());
    }
    if (t.repeat === 'monthly') {
      const days = Array.isArray(t.monthDays) ? t.monthDays : [];
      if (!days.length) return false;
      const months = Array.isArray(t.monthlyMonths) && t.monthlyMonths.length ? t.monthlyMonths : null;
      if (months && months.indexOf(d.getMonth() + 1) < 0) return false;
      const last = lastDayOf(d.getFullYear(), d.getMonth());
      return days.some((w) => Math.min(w, last) === d.getDate());
    }
    return false;
  }

  // 是否到了该提醒的时候（渲染进程 / node 测试共用）
  // - 有截止：从「最迟开始」（没设就是截止）起每天提醒，过了截止算逾期
  // - 没有截止 + 每天 + 提醒时间：当天到点之后才提醒，一天一次（按日期去重由调用方做）
  function remindInfo(t, now) {
    if (!t || t.done) return null;
    const nowTs = +now;

    // 「按重复日提前提醒」：每个重复日的提醒时间到点后才提醒，截止日期只当最后期限
    if (t.remindByRepeat && (t.repeat === 'weekly' || t.repeat === 'monthly')) {
      const nd = new Date(nowTs);
      const dueTs = t.due ? +new Date(t.due) : null;
      const dueOk = dueTs !== null && Number.isFinite(dueTs);
      if (dueOk && nowTs > dueTs) {
        return { overdue: true, daysLeft: 0, started: true, occurrence: true };
      }
      const [hh, mm] = parseHM(t.remindAt, [9, 0]);
      const at = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), hh, mm, 0, 0);
      if (isRepeatDay(t, nd) && nowTs >= +at) {
        const daysLeft = dueOk ? Math.max(0, Math.ceil((dueTs - nowTs) / 86400000)) : 0;
        return { overdue: false, daysLeft, started: true, occurrence: true, at: +at };
      }
      return null;
    }

    if (!t.due) {
      if (t.repeat !== 'daily' || !t.remindAt) return null;
      const m = String(t.remindAt).match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const nd = new Date(nowTs);
      const at = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), Math.min(23, +m[1]), Math.min(59, +m[2]), 0, 0);
      if (nowTs >= +at) return { overdue: false, daysLeft: 0, started: true, daily: true, at: +at };
      return null;
    }
    const due = new Date(t.due);
    if (!Number.isFinite(+due)) return null;
    const start = t.startAt ? new Date(t.startAt) : null;
    const begin = start !== null ? Math.min(+start, +due) : +due;
    if (nowTs < begin) return null;
    return {
      overdue: nowTs > +due,
      daysLeft: Math.max(0, Math.ceil((+due - nowTs) / 86400000)),
      started: start !== null && nowTs >= +start,
    };
  }

  return { nextWeeklyTime, nextMonthlyTime, rollTask, rollAll, localISO, remindInfo, parseHM, isRepeatDay };
});
