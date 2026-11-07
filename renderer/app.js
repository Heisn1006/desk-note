'use strict';

/* ------------------------------------------------------------------
   DeskNote 渲染进程
   - 图形化新建任务：截止时间 / 最迟开始时间 / 提前提醒天数
   - 倒计时窗口内每天提醒
   ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
// 界面文案统一走 i18n；注意别叫 t，否则会和函数里的 t（任务对象）撞名
const tr = (key, params) => i18n.t(key, params);

let tasks = [];
let settings = {};
let showDone = false;
let flashId = null;
let kbId = null;   // 键盘选中的任务 id（↑↓ 移动，空格完成，Delete 删除，Enter 编辑）
let appVersion = '';
let footTimer = null;
window.getDeskSettings = () => settings;

// 插件宿主直接读这份开关（避免跨脚本读 settings 的时序问题）
function syncPluginOptions() {
  const p = settings.plugins || {};
  window.__deskPluginOptions = {
    engine: !!p.wallpaperEngine,
    capture: !!p.wallpaperCapture,
    low: !!p.wallpaperLowPower,
  };
}

/* ---------------- 小工具 ---------------- */

const localISO = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid = () => Math.random().toString(36).slice(2, 9);

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- 键盘选择 ---------------- */

const taskEl = (id) => $(`#list .task[data-id="${CSS.escape(String(id))}"]`);

function setKbFocus(id, scroll) {
  kbId = id || null;
  document.querySelectorAll('#list .task.kb-focus').forEach((el) => el.classList.remove('kb-focus'));
  if (!kbId) return;
  const el = taskEl(kbId);
  if (!el) return;
  el.classList.add('kb-focus');
  if (scroll) el.scrollIntoView({ block: 'nearest' });
}

// 渲染后保持选中；选中的那条没了（比如刚被标记完成收进"已完成"）就落到第一条
function syncKbFocus() {
  if (!kbId) return;
  if (!taskEl(kbId)) {
    const first = $('#list .task');
    kbId = first ? first.dataset.id : null;
  }
  setKbFocus(kbId, false);
}

function moveKbFocus(delta) {
  const els = [...document.querySelectorAll('#list .task')];
  if (!els.length) return;
  const idx = els.findIndex((el) => el.dataset.id === kbId);
  const next = idx < 0 ? (delta > 0 ? 0 : els.length - 1) : Math.max(0, Math.min(els.length - 1, idx + delta));
  setKbFocus(els[next].dataset.id, true);
}

let toastTimer = null;
function showToast(text, ms = 2400) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 200);
  }, ms);
}

function relText(due, now) {
  return i18n.relText(due, now);
}

function dueText(t) {
  return i18n.fmtDue(t);
}

function startText(t) {
  return i18n.fmtStart(t);
}

function groupOf(t, now) {
  if (t.done) return 'done';
  if (!t.due) return 'later';
  const d = new Date(t.due);
  if (+d < +now) return 'over';
  const diff = dayDiff(d, now);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= 7) return 'week';
  return 'later';
}

// 全角圆括号在雅黑里会往下沉，统一成方块括号【】
function normalizeTitle(s) {
  // 只转全角括号；半角 () 保留，避免把代码 / 英文标题里的括号改坏
  return String(s).replace(/（/g, '【').replace(/）/g, '】');
}

const byDue = (a, b) => {
  const av = a.due ? +new Date(a.due) : Number.POSITIVE_INFINITY;
  const bv = b.due ? +new Date(b.due) : Number.POSITIVE_INFINITY;
  return av - bv;
};

// 提醒窗口：从「最迟开始」到截止，期间每天提醒；没设开始时间就在截止之后（逾期）提醒
function remindInfo(t, now) {
  if (t.done || !t.due) return null;
  const due = +new Date(t.due);
  const start = t.startAt ? +new Date(t.startAt) : null;
  const begin = start !== null ? Math.min(start, due) : due;
  if (+now < begin) return null;
  return {
    overdue: +now > due,
    daysLeft: Math.max(0, Math.ceil((due - +now) / 86400000)),
    started: start !== null && +now >= start,
  };
}

/* ---------------- 快速添加：自然语言解析 ---------------- */

function parseQuick(raw, now) {
  let s = ' ' + raw.replace(/\s+/g, ' ').trim() + ' ';
  let dayOffset = null;
  let weekday = null;
  let nextWeek = false;
  let month = null;
  let mday = null;
  let hour = null;
  let minute = 0;
  let relVal = null;
  let relUnit = null;

  const eat = (re, cb) => {
    const m = s.match(re);
    if (!m) return false;
    s = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ');
    cb(m);
    return true;
  };

  eat(/(大后天|后天|明天|今天|今晚)/, (m) => {
    dayOffset = { 今天: 0, 今晚: 0, 明天: 1, 后天: 2, 大后天: 3 }[m[1]];
    if (m[1] === '今晚') hour = 20;
  });

  eat(/下(?:个)?(?:周|星期|礼拜)([一二三四五六日天])/, (m) => {
    weekday = '一二三四五六日天'.indexOf(m[1]);
    nextWeek = true;
  });
  if (weekday === null) {
    eat(/(?:周|星期|礼拜)([一二三四五六日天])/, (m) => {
      weekday = '一二三四五六日天'.indexOf(m[1]);
    });
  }

  eat(/(?<![\d.])(\d{1,2})\s*[月/]\s*(\d{1,2})\s*[日号]?/, (m) => {
    month = Number(m[1]);
    mday = Number(m[2]);
  });

  eat(/(\d+)\s*个?\s*(天|小时|钟头|分钟)\s*(?:后|以后|之后)/, (m) => {
    relVal = Number(m[1]);
    relUnit = m[2];
  });

  eat(/(上午|中午|下午|晚上|傍晚|凌晨|早上|晚)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{1,2})|点\s*(半|(\d{1,2}))?)/, (m) => {
    hour = Number(m[2]);
    minute = m[3] != null ? Number(m[3]) : m[4] === '半' ? 30 : m[5] ? Number(m[5]) : 0;
    const p = m[1] || '';
    if (/下午|晚上|傍晚|晚/.test(p) && hour < 12) hour += 12;
    if (/中午/.test(p) && hour < 12) hour = 12;
    if (/凌晨|早上|上午/.test(p) && hour === 12) hour = 0;
  });

  const d = new Date(now);
  d.setSeconds(0, 0);
  let hasTime = hour != null;

  if (relVal != null) {
    const step = /天/.test(relUnit) ? 86400000 : /小时|钟头/.test(relUnit) ? 3600000 : 60000;
    const t = new Date(now.getTime() + relVal * step);
    d.setFullYear(t.getFullYear(), t.getMonth(), t.getDate());
    d.setHours(t.getHours(), t.getMinutes(), 0, 0);
    hasTime = !/天/.test(relUnit);
    if (!hasTime) d.setHours(23, 59, 0, 0);
  } else {
    if (month != null && mday != null) {
      d.setMonth(month - 1, mday);
      if (+d < +now && dayOffset == null && weekday == null) d.setFullYear(d.getFullYear() + 1);
    } else if (weekday != null) {
      const dowMon = (x) => (x.getDay() + 6) % 7;
      if (nextWeek) d.setDate(d.getDate() + (7 - dowMon(d)) + weekday);
      else d.setDate(d.getDate() + ((weekday - dowMon(d) + 7) % 7));
    } else if (dayOffset != null) {
      d.setDate(d.getDate() + dayOffset);
    }

    if (hasTime) {
      d.setHours(hour, minute, 0, 0);
      const onlyTime = dayOffset == null && weekday == null && month == null;
      if (onlyTime && +d < +now) d.setDate(d.getDate() + 1);
    } else {
      d.setHours(23, 59, 0, 0);
    }
  }

  let title = s.replace(/\s+/g, ' ').trim();
  title = title.replace(/^[,，。;；、:：\-—]+|[,，。;；、:：\-—]+$/g, '').trim();
  if (!title) title = raw.trim();

  return { title, due: localISO(d), hasTime };
}

/* ---------------- 渲染 ---------------- */

function rowHTML(t, now) {
  const due = t.due ? new Date(t.due) : null;
  const remind = remindInfo(t, now);

  let badge;
  if (t.done) badge = `<span class="badge mute">${tr('task.doneBadge')}</span>`;
  else if (due) {
    const cls = +due < +now ? 'over' : dayDiff(due, now) === 0 ? 'soon' : 'far';
    badge = `<span class="badge ${cls}">${relText(due, now)}</span>`;
  } else badge = `<span class="badge far">${tr('task.noDue')}</span>`;

  const bell = remind ? `<span class="bell" title="${tr('task.bellTip')}">🔔</span>` : '';
  const dueMeta = due ? `<span class="abs">${tr('task.dueMeta', { when: dueText(t) })}</span>` : '';
  const repeatTag =
    t.repeat === 'weekly'
      ? `<span class="repeat-tag" title="${tr('task.repeatTip')}">${tr('task.repeatTag')}</span>`
      : '';
  // 用户自己命名的标题原样输出，不翻译、不改写
  const rowTip = t.startAt ? tr('task.tipStart', { date: startText(t) }) : tr('task.tipEdit');

  return `<div class="task ${t.done ? 'is-done' : ''} ${remind ? 'is-reminding' : ''} ${
    t.id === flashId ? 'enter' : ''
  }" data-id="${t.id}" title="${rowTip}">
    <button class="check" data-act="toggle" title="${t.done ? tr('task.markUndone') : tr('task.markDone')}"></button>
    <div class="body">
      <div class="title">${bell}${esc(t.title)}</div>
      <div class="meta">${badge}${repeatTag}${dueMeta}</div>
    </div>
    <button class="del" data-act="del" title="${tr('task.del')}">×</button>
  </div>`;
}

function render() {
  const now = new Date();
  const buckets = { over: [], today: [], tomorrow: [], week: [], later: [], done: [] };
  for (const t of tasks) buckets[groupOf(t, now)].push(t);
  for (const k of Object.keys(buckets)) buckets[k].sort(byDue);

  $('#dayText').textContent = i18n.fmtDay(now);

  const active = tasks.filter((t) => !t.done);
  const bits = [];
  if (buckets.over.length) bits.push(tr('sub.over', { n: buckets.over.length }));
  if (buckets.today.length) bits.push(tr('sub.today', { n: buckets.today.length }));
  if (buckets.tomorrow.length) bits.push(tr('sub.tomorrow', { n: buckets.tomorrow.length }));
  if (buckets.week.length) bits.push(tr('sub.week', { n: buckets.week.length }));
  $('#subText').textContent = bits.length
    ? bits.join(' · ')
    : active.length
      ? tr('sub.active', { n: active.length })
      : tr('sub.clear');

  // 顶部提醒条
  const reminding = tasks.filter((t) => remindInfo(t, now)).sort(byDue);
  const upcoming = tasks.filter((t) => !t.done && t.due).sort(byDue);
  const next = upcoming.find((t) => +new Date(t.due) >= +now);
  const nu = $('#nextup');

  if (reminding.length) {
    const f = reminding[0];
    const info = remindInfo(f, now);
    const d = new Date(f.due);
    $('#nuLabel').textContent = tr('nu.remind');
    $('#nuTime').textContent = i18n.clipTitle(f.title);
    $('#nuTitle').textContent = reminding.length > 1 ? tr('nu.more', { n: reminding.length }) : '';
    $('#nuCd').textContent = info.overdue
      ? relText(d, now)
      : tr('nu.left', { n: info.daysLeft });
    nu.hidden = false;
  } else if (next && dayDiff(new Date(next.due), now) <= 1) {
    const d = new Date(next.due);
    $('#nuLabel').textContent = tr('nextup.label');
    $('#nuTime').textContent = next.hasTime
      ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
      : tr('nu.allday');
    $('#nuTitle').textContent = next.title;
    $('#nuCd').textContent = relText(d, now);
    nu.hidden = false;
  } else {
    nu.hidden = true;
  }

  const groups = ['over', 'today', 'tomorrow', 'week', 'later'].map((key) => [key, i18n.groupLabel(key)]);

  let html = '';
  if (!active.length) {
    html =
      '<div class="empty"><span class="big">' +
      '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 9h12v5.5A4.5 4.5 0 0 1 11.5 19h-3A4.5 4.5 0 0 1 4 14.5V9z"/>' +
      '<path d="M16 10.5h1.8a2.2 2.2 0 0 1 0 4.4H16"/>' +
      '<path d="M7.5 3.5v2M10.5 3.5v2M13.5 3.5v2"/>' +
      '</svg></span>' +
      `${tr('empty.title')}<br />${tr('empty.hint')}</div>`;
  } else {
    for (const [key, label] of groups) {
      const items = buckets[key];
      if (!items.length) continue;
      html += `<div class="group"><span>${label}</span><span class="line"></span><span class="count${
        key === 'over' ? ' over' : ''
      }">${items.length}</span></div>`;
      for (const t of items) html += rowHTML(t, now);
    }
  }

  if (buckets.done.length) {
    if (!showDone) {
      html += `<button class="done-row" data-act="showdone">${tr('done.show', {
        n: buckets.done.length,
      })}</button>`;
    } else {
      html += `<div class="group"><span>${tr('group.done')}</span><span class="line"></span><span class="count">${
        buckets.done.length
      }</span></div>`;
      for (const t of buckets.done) html += rowHTML(t, now);
      html += `<button class="done-row" data-act="hidedone">${tr('done.hide')}</button>`;
    }
  }

  $('#list').innerHTML = html;
  syncKbFocus();

  renderMini();

  // 每日提醒（一天只弹一次）
  maybeNotify(reminding, now);
}

// 时间规则在 schedule.js（纯函数，可用 node 直接测「隔一年」的情况）
const nextWeeklyTime = (...args) => window.deskSchedule.nextWeeklyTime(...args);

// 每周任务：过期了就滚到下一个选中的日子；离线很久也只会落到「现在之后」
function rollWeekly(now) {
  const changed = window.deskSchedule.rollAll(tasks, +now);
  if (changed) persist();
  return changed;
}

/* ---------------- 数据 ---------------- */

async function persist() {
  try {
    await window.desk.saveTasks(tasks);
  } catch (err) {
    console.error('保存失败', err);
  }
}

function addTask(fields) {
  const task = {
    id: uid(),
    title: normalizeTitle(fields.title),
    done: false,
    startAt: null,
    repeat: '',
    createdAt: new Date().toISOString(),
    ...fields,
  };
  tasks.unshift(task);
  flashId = task.id;
  persist();
  render();
  setTimeout(() => {
    flashId = null;
  }, 400);
}

function toggleTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;

  // 每周重复：先标记完成（进「已完成」），并记下下次该重置到的时刻；
  // 到点后由 rollWeekly() 读系统时间自动重置为未完成
  if (!t.done && t.repeat === 'weekly' && t.due) {
    const due = new Date(t.due);
    const days = Array.isArray(t.repeatDays) && t.repeatDays.length ? t.repeatDays : [due.getDay()];
    const next = nextWeeklyTime(Date.now(), days, due.getHours(), due.getMinutes()) || new Date(+due + 7 * 86400000);
    t.done = true;
    t.doneAt = new Date().toISOString();
    t.nextAt = localISO(next);           // 下次自动重置的时刻
    t.nextStartAt = t.startAt
      ? localISO(new Date(+new Date(t.startAt) + (+next - +due)))
      : null;
    flashId = t.id;
    persist();
    render();
    setTimeout(() => {
      flashId = null;
    }, 400);
    return;
  }

  t.done = !t.done;
  t.doneAt = t.done ? new Date().toISOString() : null;
  persist();
  render();
}

function removeTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  persist();
  render();
}

/* ---------------- 编辑器 ---------------- */

const ed = {
  wrap: $('#editor'),
  title: $('#edTitle'),
  dueDate: $('#edDueDate'),
  dueHour: $('#edDueHour'),
  dueMin: $('#edDueMin'),
  startDate: $('#edStartDate'),
  startHour: $('#edStartHour'),
  startMin: $('#edStartMin'),
  repeat: $('#edRepeat'),
  hasStart: $('#edHasStart'),
  startRow: $('#startRow'),
  repeatDaysRow: $('#repeatDaysRow'),
  save: $('#edSave'),
  cancel: $('#edCancel'),
};

let editingId = null;

function pad2(n, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return String(Math.max(0, Math.min(59, Math.round(v)))).padStart(2, '0');
}

function setTimeFields(hEl, mEl, str) {
  const [h, m] = String(str || '18:00').split(':');
  if (hEl) hEl.value = String(Math.max(0, Math.min(23, Number(h) || 0))).padStart(2, '0');
  if (mEl) mEl.value = String(Math.max(0, Math.min(59, Number(m) || 0))).padStart(2, '0');
}

function readTimeFields(hEl, mEl) {
  const h = Math.max(0, Math.min(23, Number(hEl && hEl.value) || 0));
  const m = Math.max(0, Math.min(59, Number(mEl && mEl.value) || 0));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function openEditor(task) {
  const now = new Date();
  editingId = task ? task.id : null;
  ed.wrap.hidden = false;
  ed.save.textContent = editingId ? tr('ed.save') : tr('ed.add');

  if (task) {
    ed.title.value = task.title;
    const due = task.due ? new Date(task.due) : now;
    ed.dueDate.value = dateStr(due);
    setTimeFields(ed.dueHour, ed.dueMin, task.hasTime ? timeStr(due) : '23:59');
    ed.hasStart.checked = !!task.startAt;
    ed.startRow.hidden = !task.startAt;
    ed.repeat.value = task.repeat || '';
    const days = Array.isArray(task.repeatDays) ? task.repeatDays : [];
    document.querySelectorAll('.day-chip').forEach((chip) => {
      chip.classList.toggle('active', days.includes(Number(chip.dataset.d)));
    });
    ed.repeatDaysRow.hidden = ed.repeat.value !== 'weekly';
    if (task.startAt) {
      const s = new Date(task.startAt);
      ed.startDate.value = dateStr(s);
      setTimeFields(ed.startHour, ed.startMin, timeStr(s));
    } else {
      ed.startDate.value = '';
      setTimeFields(ed.startHour, ed.startMin, '09:00');
    }
  } else {
    ed.title.value = '';
    ed.dueDate.value = dateStr(now);
    setTimeFields(ed.dueHour, ed.dueMin, '18:00');
    const start = new Date(now);
    start.setDate(start.getDate() - 2);
    ed.startDate.value = dateStr(start);
    setTimeFields(ed.startHour, ed.startMin, '09:00');
    ed.hasStart.checked = false;
    ed.startRow.hidden = true;
    ed.repeat.value = '';
    document.querySelectorAll('.day-chip').forEach((chip) => chip.classList.remove('active'));
    ed.repeatDaysRow.hidden = true;
  }

  ed.wrap.hidden = false;
  ed.title.focus();
  const len = ed.title.value.length;
  try {
    ed.title.setSelectionRange(len, len);   // 光标放末尾，不全选，避免误触退格清空
  } catch {}
}

function closeEditor() {
  ed.wrap.hidden = true;
  editingId = null;
  // 收起后把焦点还给页面，否则 Delete/空格还会被隐藏的输入框吃掉
  const active = document.activeElement;
  if (active && ed.wrap.contains(active) && typeof active.blur === 'function') active.blur();
}

function saveEditor() {
  const title = ed.title.value.trim();
  if (!title) {
    ed.title.focus();
    return;
  }
  const dDate = ed.dueDate.value || dateStr(new Date());
  const dTime = readTimeFields(ed.dueHour, ed.dueMin);
  const sDate = ed.startDate.value || '';
  const sTime = readTimeFields(ed.startHour, ed.startMin);

  const fields = {
    title,
    due: `${dDate}T${dTime || '23:59'}`,
    hasTime: !!dTime,
    startAt: ed.hasStart.checked && sDate ? `${sDate}T${sTime || '00:00'}` : null,
    repeat: ed.repeat.value || '',
    repeatDays:
      ed.repeat.value === 'weekly'
        ? [...document.querySelectorAll('.day-chip.active')].map((c) => Number(c.dataset.d))
        : [],
  };

  if (editingId) {
    const t = tasks.find((x) => x.id === editingId);
    if (t) Object.assign(t, { ...fields, title: normalizeTitle(fields.title) });
    flashId = editingId;
    persist();
    render();
  } else {
    addTask(fields);
  }
  closeEditor();
}

$('#btnPick').addEventListener('click', () => openEditor(null));

// 是否设置最迟开始
ed.hasStart.addEventListener('change', () => {
  ed.startRow.hidden = !ed.hasStart.checked;
  if (ed.hasStart.checked && !ed.startDate.value) {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    ed.startDate.value = dateStr(d);
  }
});

// 重复方式切换 -> 显示 / 隐藏星期选择
ed.repeat.addEventListener('change', () => {
  ed.repeatDaysRow.hidden = ed.repeat.value !== 'weekly';
});

// 星期多选
document.querySelectorAll('.day-chip').forEach((chip) => {
  chip.addEventListener('click', () => chip.classList.toggle('active'));
});
ed.cancel.addEventListener('click', closeEditor);
ed.save.addEventListener('click', saveEditor);
ed.title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveEditor();
    e.stopPropagation();
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    closeEditor();
  }
});

// 右键任务 → 直接编辑（改标题 / 截止 / 最迟开始 / 提前提醒）
$('#list').addEventListener('contextmenu', (e) => {
  const host = e.target.closest('.task');
  if (!host) return;
  e.preventDefault();
  setKbFocus(host.dataset.id, false);
  const t = tasks.find((x) => x.id === host.dataset.id);
  if (t) openEditor(t);
});

/* ---------------- 事件 ---------------- */

$('#list').addEventListener('click', (e) => {
  const hostEl = e.target.closest('.task');
  if (hostEl) setKbFocus(hostEl.dataset.id, false);
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const host = btn.closest('.task');
  const id = host ? host.dataset.id : null;

  if (act === 'toggle') toggleTask(id);
  else if (act === 'del') removeTask(id);
  else if (act === 'showdone') {
    showDone = true;
    render();
  } else if (act === 'hidedone') {
    showDone = false;
    render();
  }
});

let miniMode = false;

function applyMiniUI(on) {
  miniMode = on;
  document.body.classList.toggle('mini', on);
  if (on) {
    // 收起时把浮层一起收掉，否则会压在迷你条上
    const pm = $('#pluginsModal');
    if (pm) pm.hidden = true;
    if ($('#cropper') && !$('#cropper').hidden) closeCropper(false);
    const panel = $('#settingsPanel');
    if (panel) panel.hidden = true;
  }
  renderMini();
  setTimeout(() => {
    layoutBg();
    updateFootMetrics();
  }, 0);
}

function setMini(on) {
  applyMiniUI(on);
  window.desk.setMini(on);
}

function renderMini() {
  if (!miniMode) return;
  const now = new Date();
  $('#miniDate').textContent = i18n.fmtDay(now);

  const active = tasks.filter((t) => !t.done);
  const timed = tasks.filter((t) => !t.done && t.due).sort(byDue);
  const next = timed.find((t) => +new Date(t.due) >= +now);

  const n = active.length;
  const num = `<b class="mini-count${n === 0 ? ' zero' : ''}">${n}</b>`;
  $('#miniNext').innerHTML = next
    ? tr('mini.todoNext', { n: num, title: esc(next.title) })
    : tr('mini.todo', { n: num });
}

$('#btnHide').addEventListener('click', () => setMini(true));
$('#miniExpand').addEventListener('click', () => setMini(false));
$('#btnClose').addEventListener('click', () => window.desk.quit());

$('#ckAuto').addEventListener('change', async (e) => {
  settings = await window.desk.saveSettings({ autostart: e.target.checked });
  e.target.checked = !!settings.autostart;
});

window.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const tag = active ? active.tagName : '';
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (active && active.isContentEditable);

  if (e.key === 'Escape') {
    const pm = $('#pluginsModal');
    if (pm && !pm.hidden) {
      e.preventDefault();
      pm.hidden = true;
      return;
    }
    if (!ed.wrap.hidden) {
      e.preventDefault();
      closeEditor();
      return;
    }
    const panel = $('#settingsPanel');
    if (panel && !panel.hidden) {
      e.preventDefault();
      panel.hidden = true;
      return;
    }
    setKbFocus(null);
    window.desk.hide();
    return;
  }

  // 输入中 / 编辑器打开 / 设置面板打开 / 迷你态：都不抢任务快捷键
  if (typing || !ed.wrap.hidden) return;
  const panelEl = $('#settingsPanel');
  if ((panelEl && !panelEl.hidden) || document.body.classList.contains('mini')) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    moveKbFocus(e.key === 'ArrowDown' ? 1 : -1);
    return;
  }

  if (!kbId) return;

  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    toggleTask(kbId);
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const task = tasks.find((x) => x.id === kbId);
    if (task) openEditor(task);
    return;
  }

  if (e.key === 'Delete') {
    e.preventDefault();
    const ids = [...document.querySelectorAll('#list .task')].map((el) => el.dataset.id);
    const i = ids.indexOf(kbId);
    const nextId = ids[i + 1] || ids[i - 1] || null;
    removeTask(kbId);
    setKbFocus(nextId, true);
  }
});

window.addEventListener('focus', () => render());
window.addEventListener('resize', () => {
  layoutBg();
  updateFootMetrics();
  if (!$('#cropper').hidden) layoutCropper();
});

/* ---------------- 皮肤 / 背景 ---------------- */

function applyTheme(theme) {
  const t = theme || 'paper';
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('.swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === t);
  });
}

/* ---------------- 背景：裁切 + 浓度 ---------------- */

const bgState = { url: null, loadedUrl: null, nat: null, crop: { zoom: 1, x: 0, y: 0 }, fade: 1 };

function applyBg(url, crop, fade) {
  const layer = $('#bgLayer');
  bgState.url = url || null;
  bgState.crop = window.deskCrop.normalize(crop || bgState.crop);
  const f = Number(fade);
  bgState.fade = Number.isFinite(f) ? Math.min(1, Math.max(0.15, f)) : 1;

  if (!url) {
    layer.hidden = true;
    bgState.nat = null;
    bgState.loadedUrl = null;
    return;
  }

  layer.hidden = false;
  $('#bgVeil').style.opacity = String(bgState.fade);

  if (bgState.loadedUrl !== url) {
    bgState.loadedUrl = url;
    bgState.nat = null;
    const im = new Image();
    im.onload = () => {
      if (bgState.url !== url) return;      // 等图期间又换了一张
      bgState.nat = { w: im.naturalWidth, h: im.naturalHeight };
      layoutBg();
    };
    im.onerror = () => {
      if (bgState.url === url) layer.hidden = true;
    };
    im.src = url;
    return;
  }
  layoutBg();
}

/* ---------------- 页脚文案 / 字体 ---------------- */

function applyFooter() {
  const el = document.querySelector('.foot-ver');
  if (!el) return;
  const f = settings.footer || {};
  const custom = typeof f.text === 'string' ? f.text.trim() : '';
  el.textContent = custom || (appVersion ? `DeskNote v${appVersion}` : 'DeskNote');
  el.style.fontFamily = f.font || '';
  el.style.fontStyle = f.italic ? 'italic' : '';
  syncFooterControls();
  updateFootMetrics();
}

// 页脚变高时，设置面板和 toast 跟着上移
function updateFootMetrics() {
  const foot = document.querySelector('.foot');
  const h = foot ? Math.round(foot.getBoundingClientRect().height) : 39;
  document.documentElement.style.setProperty('--foot-h', `${h || 39}px`);
}

function syncFooterControls() {
  const f = settings.footer || {};
  const t = $('#spFootText');
  if (t && document.activeElement !== t) t.value = typeof f.text === 'string' ? f.text : '';
  const sel = $('#spFootFont');
  if (sel) sel.value = f.font || '';
  const ital = $('#spFootItalic');
  if (ital) ital.checked = !!f.italic;
}

function setFooter(patch) {
  settings.footer = Object.assign({}, settings.footer || {}, patch);
  applyFooter();
  clearTimeout(footTimer);
  footTimer = setTimeout(async () => {
    settings = await window.desk.saveSettings({ footer: settings.footer });
  }, 250);
}

function layoutBg() {
  if (!bgState.url || !bgState.nat) return;
  const card = $('#card');
  const W = card.clientWidth;
  const H = card.clientHeight;
  if (!W || !H) return;
  const l = window.deskCrop.layout(W, H, bgState.nat.w, bgState.nat.h, bgState.crop);
  const img = $('#bgImg');
  if (img.getAttribute('src') !== bgState.url) img.src = bgState.url;
  img.style.width = `${l.rw}px`;
  img.style.height = `${l.rh}px`;
  img.style.left = `${l.left}px`;
  img.style.top = `${l.top}px`;
}

/* ---------------- 背景裁切面板 ---------------- */

let cropSession = null;
let cropDrag = null;

const loadImageSize = (url) =>
  new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve(null);
    im.src = url;
  });

async function openCropper(url) {
  const nat = await loadImageSize(url);
  if (!nat) {
    showToast(tr('crop.failed'));
    window.desk.discardBg(url);
    return;
  }
  cropSession = { url, nat, crop: { zoom: 1, x: 0, y: 0 }, fade: bgState.fade };
  $('#cropFade').value = String(Math.round(cropSession.fade * 100));
  $('#cropper').hidden = false;
  layoutCropper();
}

function layoutCropper() {
  const panel = $('#cropper');
  if (!cropSession || panel.hidden) return;
  const card = $('#card');
  const W = card.clientWidth;
  const H = card.clientHeight;
  const maxW = Math.max(120, W - 64);
  const maxH = Math.max(120, H - 132);
  let fw = Math.min(maxW, 300);
  let fh = Math.round(fw * (H / W));
  if (fh > maxH) {
    fh = maxH;
    fw = Math.round(fh * (W / H));
  }
  const frame = $('#cropFrame');
  frame.style.width = `${fw}px`;
  frame.style.height = `${fh}px`;

  const l = window.deskCrop.layout(fw, fh, cropSession.nat.w, cropSession.nat.h, cropSession.crop);
  const img = $('#cropImg');
  img.src = cropSession.url;
  img.style.width = `${l.rw}px`;
  img.style.height = `${l.rh}px`;
  img.style.left = `${l.left}px`;
  img.style.top = `${l.top}px`;

  // 幽灵图：和取景框用同一套比例，叠在暗背景上，让用户看到框外还有什么
  const fr = frame.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  const ghost = $('#cropGhost');
  ghost.src = cropSession.url;
  ghost.style.width = `${l.rw}px`;
  ghost.style.height = `${l.rh}px`;
  ghost.style.left = `${fr.left - cr.left + l.left}px`;
  ghost.style.top = `${fr.top - cr.top + l.top}px`;
}

function closeCropper(discard) {
  const s = cropSession;
  cropSession = null;
  cropDrag = null;
  $('#cropper').hidden = true;
  if (discard && s && s.url !== settings.bg) window.desk.discardBg(s.url);
}

function fmtAccel(accel) {
  return String(accel || 'Control+Alt+N')
    .split('+')
    .map((k) => (k === 'Control' ? 'Ctrl' : k))
    .join(' + ');
}

function renderHotkeyLabel() {
  const btn = $('#hotkeyBtn');
  if (btn) btn.textContent = fmtAccel(settings.hotkey);
}

/* 切语言：只换界面文案，用户写的任务标题不参与翻译 */
function applyLang(next, skipRender) {
  const lang = i18n.setLang(next);
  i18n.applyStatic(document);
  const sel = $('#spLang');
  if (sel) sel.value = lang;
  if (!ed.wrap.hidden) ed.save.textContent = editingId ? tr('ed.save') : tr('ed.add');
  renderHotkeyLabel();
  if (!skipRender) render();
  return lang;
}

/* ---------------- 插件管理 ---------------- */

async function openPlugins() {
  const modal = $('#pluginsModal');
  if (!modal) return;
  modal.hidden = false;
  const box = $('#pmList');
  box.innerHTML = '';
  let list = [];
  try {
    list = await window.desk.listPlugins();
  } catch (err) {
    console.error('列出插件失败', err);
  }
  if (!Array.isArray(list) || !list.length) {
    box.innerHTML = `<div class="pm-empty">${tr('plugin.empty')}</div>`;
    return;
  }
  for (const p of list) {
    const item = document.createElement('div');
    item.className = 'pm-item';
    item.innerHTML =
      '<div class="pm-main">' +
      `<div class="pm-body"><div class="pm-name">${esc(p.name)}<span class="pm-ver">v${esc(p.version)}</span></div>` +
      `<div class="pm-desc">${esc(p.description)}</div></div>` +
      `<button class="pm-trash" title="${tr('plugin.remove')}" aria-label="${tr('plugin.remove')}">` +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline>' +
      '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>' +
      '<path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>' +
      '</button>' +
      `<label class="switch"><input type="checkbox" ${p.enabled ? 'checked' : ''} /><span class="track"></span></label>` +
      '</div>';

    item.querySelector('input').addEventListener('change', async (e) => {
      const map = Object.assign({}, settings.plugins || {});
      map[p.id] = e.target.checked;
      settings.plugins = map;
      syncPluginOptions();
      await window.desk.saveSettings({ plugins: map });
      if (window.deskPluginHost) window.deskPluginHost.setEnabled(p.id, e.target.checked);
      if (p.id === 'wallpaper') syncBgAvailability();
    });

    if (p.id === 'wallpaper') {
      const note = document.createElement('div');
      note.className = 'pm-warn';
      note.textContent = tr('plugin.bgConflict');
      item.querySelector('.pm-body').appendChild(note);
      const opt = (k) => !!(settings.plugins && settings.plugins[k]);
      const extra = document.createElement('div');
      extra.className = 'pm-extra';
      extra.innerHTML =
        `<label class="pm-opt"><input type="checkbox" data-opt="wallpaperEngine" ${opt('wallpaperEngine') ? 'checked' : ''}/><span>${tr('plugin.engine')}</span></label>` +
        `<label class="pm-opt"><input type="checkbox" data-opt="wallpaperCapture" ${opt('wallpaperCapture') ? 'checked' : ''}/><span>${tr('plugin.capture')}</span></label>` +
        `<label class="pm-opt"><input type="checkbox" data-opt="wallpaperLowPower" ${opt('wallpaperLowPower') ? 'checked' : ''} ${opt('wallpaperCapture') ? '' : 'disabled'}/><span>${tr('plugin.lowPower')}</span></label>`;
      extra.querySelectorAll('input').forEach((el) => {
        el.addEventListener('change', () => setPluginOption(el.dataset.opt, el.checked));
      });
      const hint = document.createElement('div');
      hint.className = 'pm-hint';
      hint.textContent = tr('plugin.engineNote');
      extra.appendChild(hint);
      item.appendChild(extra);
    }

    item.querySelector('.pm-trash').addEventListener('click', async () => {
      if (!window.confirm(tr('plugin.removeConfirm', { name: p.name }))) return;
      const res = await window.desk.removePlugin(p.id);
      if (!res || !res.ok) return;
      if (window.deskPluginHost) window.deskPluginHost.setEnabled(p.id, false);
      if (settings.plugins) delete settings.plugins[p.id];
      if (p.id === 'wallpaper') syncBgAvailability();
      openPlugins();
    });

    box.appendChild(item);
  }
}

async function setPluginOption(key, on) {
  const map = Object.assign({}, settings.plugins || {});
  map[key] = on;
  // 打开任一壁纸来源时顺手启用插件；“读 WE 项目”和“屏幕取景”二选一
  if (key === 'wallpaperCapture' && on) {
    map.wallpaper = true;
    map.wallpaperEngine = false;
  }
  if (key === 'wallpaperEngine' && on) {
    map.wallpaper = true;
    map.wallpaperCapture = false;
  }
  settings.plugins = map;
  syncPluginOptions();
  await window.desk.saveSettings({ plugins: map });
  if (window.deskPluginHost && map.wallpaper) {
    window.deskPluginHost.setEnabled('wallpaper', false);
    window.deskPluginHost.setEnabled('wallpaper', true);
  }
  openPlugins();
}

function wallpaperOn() {
  return !!(settings.plugins && settings.plugins.wallpaper);
}

// 壁纸穿透和自定义背景互斥：开着壁纸时，背景按钮直接禁用
function syncBgAvailability() {
  const on = wallpaperOn();
  for (const el of [$('#btnPickBg'), $('#btnClearBg')]) {
    if (!el) continue;
    el.disabled = on;
    el.title = on ? tr('bg.blockedByWallpaper') : '';
  }
}

function initSettingsUI() {
  const panel = $('#settingsPanel');

  // 语言：立即生效 + 写进设置，下次启动沿用
  const langSel = $('#spLang');
  langSel.value = i18n.getLang();
  langSel.addEventListener('change', async () => {
    applyLang(langSel.value);
    settings = await window.desk.saveSettings({ lang: langSel.value });
  });

  $('#btnSettings').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });
  // 点空白处收起
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || e.target.closest('#btnSettings')) return;
    panel.hidden = true;
  });

  document.querySelectorAll('.swatch').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
      await window.desk.saveSettings({ theme });
    });
  });

  $('#btnPickBg').addEventListener('click', async () => {
    const picked = await window.desk.pickBg();
    if (!picked || !picked.url) return;
    panel.hidden = true;
    openCropper(picked.url);
  });

  $('#btnClearBg').addEventListener('click', async () => {
    const old = settings.bg;
    applyBg(null);
    settings = await window.desk.saveSettings({ bg: null, bgCrop: null, bgFade: 1 });
    if (old) window.desk.discardBg(old);
  });

  // 裁切面板：拖动 / 滚轮 / 浓度 / 重置 / 取消 / 确定
  const cropFrame = $('#cropFrame');
  cropFrame.addEventListener('pointerdown', (e) => {
    if (!cropSession) return;
    cropDrag = { x: e.clientX, y: e.clientY };
    try {
      cropFrame.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  });
  cropFrame.addEventListener('pointermove', (e) => {
    if (!cropDrag || !cropSession) return;
    const dx = e.clientX - cropDrag.x;
    const dy = e.clientY - cropDrag.y;
    cropDrag = { x: e.clientX, y: e.clientY };
    cropSession.crop = window.deskCrop.pan(
      cropFrame.clientWidth,
      cropFrame.clientHeight,
      cropSession.nat.w,
      cropSession.nat.h,
      cropSession.crop,
      dx,
      dy
    );
    layoutCropper();
  });
  const endCropDrag = (e) => {
    cropDrag = null;
    try {
      cropFrame.releasePointerCapture(e.pointerId);
    } catch {}
  };
  cropFrame.addEventListener('pointerup', endCropDrag);
  cropFrame.addEventListener('pointercancel', endCropDrag);

  cropFrame.addEventListener(
    'wheel',
    (e) => {
      if (!cropSession) return;
      e.preventDefault();
      const r = cropFrame.getBoundingClientRect();
      cropSession.crop = window.deskCrop.zoomAt(
        cropFrame.clientWidth,
        cropFrame.clientHeight,
        cropSession.nat.w,
        cropSession.nat.h,
        cropSession.crop,
        e.clientX - r.left,
        e.clientY - r.top,
        Math.exp(-e.deltaY * 0.0012)
      );
      layoutCropper();
    },
    { passive: false }
  );

  $('#cropFade').addEventListener('input', () => {
    if (cropSession) cropSession.fade = Number($('#cropFade').value) / 100;
  });

  $('#cropReset').addEventListener('click', () => {
    if (!cropSession) return;
    cropSession.crop = { zoom: 1, x: 0, y: 0 };
    cropSession.fade = 1;
    $('#cropFade').value = '100';
    layoutCropper();
  });

  $('#cropCancel').addEventListener('click', () => closeCropper(true));

  $('#cropApply').addEventListener('click', async () => {
    if (!cropSession) return;
    const s = cropSession;
    closeCropper(false);
    applyBg(s.url, s.crop, s.fade);
    settings = await window.desk.saveSettings({ bg: s.url, bgCrop: s.crop, bgFade: s.fade });
  });

  $('#btnRestart').addEventListener('click', () => window.desk.restart());

  let updateInfo = null;

  async function runUpdateCheck() {
    const btn = $('#btnCheckUpdate');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = tr('update.checking');
    try {
      const r = await window.desk.checkUpdate(true);
      if (!r || !r.ok) {
        const e = r && r.reason === 'timeout' ? tr('update.failTimeout') : String((r && r.error) || 'network');
        showToast(tr('update.fail', { e: e.slice(0, 60) }), 3600);
        return;
      }
      updateInfo = r;
      if (!r.newer) {
        showToast(tr('update.latest', { v: r.latest }), 2400);
        return;
      }
      if (r.url && (await window.desk.openUrl(r.url))) {
        showToast(tr('update.found', { v: r.latest }), 3600);
        btn.textContent = tr('update.download', { v: r.latest });
        return;
      }
      showToast(tr('update.found', { v: r.latest }), 3600);
      if (r.url) showToast(tr('update.openFail'), 3000);
    } finally {
      btn.disabled = false;
      if (btn.textContent === tr('update.checking')) btn.textContent = old;
    }
  }

  $('#btnCheckUpdate').addEventListener('click', runUpdateCheck);

  if (window.desk.onUpdateAvailable) {
    window.desk.onUpdateAvailable((r) => {
      updateInfo = r;
      if (!r || !r.newer) return;
      console.log('[update] available ' + r.latest);
      const btn = $('#btnCheckUpdate');
      if (btn) btn.textContent = tr('update.download', { v: r.latest });
      showToast(tr('update.found', { v: r.latest }), 4200);
    });
  }

  $('#btnPlugins').addEventListener('click', openPlugins);
  $('#pmClose').addEventListener('click', () => {
    $('#pluginsModal').hidden = true;
  });

  $('#ckFullscreen').addEventListener('change', async (e) => {
    settings = await window.desk.saveSettings({ hideOnFullscreen: e.target.checked });
  });

  // 页脚自定义：文案 / 字体 / 字号
  $('#spFootText').addEventListener('input', () => setFooter({ text: $('#spFootText').value }));
  $('#spFootFont').addEventListener('change', () => setFooter({ font: $('#spFootFont').value }));
  $('#spFootItalic').addEventListener('change', () => setFooter({ italic: $('#spFootItalic').checked }));

  // ---- 数据：导出 / 导入 ----
  $('#btnExport').addEventListener('click', async () => {
    const res = await window.desk.exportData();
    if (!res || res.canceled) return;
    panel.hidden = true;
    showToast(res.ok ? tr('export.done', { n: res.count }) : tr('export.fail'));
  });

  $('#btnImport').addEventListener('click', async () => {
    const res = await window.desk.importData();
    if (!res || res.canceled) return;
    panel.hidden = true;
    if (!res.ok) {
      showToast(res.reason || tr('import.fail'), 3200);
      return;
    }
    tasks = Array.isArray(res.tasks) ? res.tasks : tasks;
    rollWeekly(new Date());
    render();
    if (!res.added) showToast(tr('import.none', { n: res.skipped }), 3200);
    else {
      const extra = res.skipped ? ' · ' + tr('import.skipped', { n: res.skipped }) : '';
      showToast(i18n.tCount('import.ok', res.added) + extra, 3200);
    }
  });

  // ---- 自定义显隐快捷键 ----
  let recording = false;
  const hkBtn = $('#hotkeyBtn');

  window.renderHotkeyLabel = renderHotkeyLabel;

  const stopRecording = () => {
    recording = false;
    hkBtn.classList.remove('recording');
    renderHotkeyLabel();
  };

  hkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (recording) {
      stopRecording();   // 再点一次 = 取消，恢复原按键
      return;
    }
    recording = true;
    hkBtn.classList.add('recording');
    hkBtn.textContent = tr('hotkey.press');
  });

  // 恢复默认快捷键
  $('#hkReset').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (recording) stopRecording();
    const res = await window.desk.setHotkey('Control+Alt+N');
    if (res && res.ok) {
      settings.hotkey = res.hotkey;
      renderHotkeyLabel();
    }
  });

  // 点到别处 / 面板收起 / 按 Esc 都要恢复
  document.addEventListener('click', (e) => {
    if (recording && !hkBtn.contains(e.target)) stopRecording();
  });
  document.addEventListener('visibilitychange', () => {
    if (recording && document.hidden) stopRecording();
  });

  window.addEventListener(
    'keydown',
    async (e) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        stopRecording();
        return;
      }

      const mods = [];
      if (e.ctrlKey) mods.push('Control');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (!mods.length) return; // 必须带修饰键

      let key = e.key;
      if (key.length === 1) key = key.toUpperCase();
      else if (/^F\d{1,2}$/.test(key)) key = key.toUpperCase();
      else if (key === ' ') key = 'Space';
      else if (key.startsWith('Arrow')) key = key.replace('Arrow', '');
      else if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
      else return;

      const accel = [...mods, key].join('+');
      const res = await window.desk.setHotkey(accel);
      recording = false;
      hkBtn.classList.remove('recording');

      if (res && res.ok) {
        settings.hotkey = res.hotkey;
        renderHotkeyLabel();
      } else {
        hkBtn.textContent = tr('hotkey.conflict');
        setTimeout(renderHotkeyLabel, 1200);
      }
    },
    true
  );

  // 等比缩放
  const spScale = $('#spScale');
  const spScaleVal = $('#spScaleVal');
  const pct = Math.round((Number(settings.uiScale) || 1) * 100);
  spScale.value = String(pct);
  spScaleVal.textContent = pct + '%';

  let scaleTimer = null;

  // 百分比气泡跟随滑块手柄
  const moveBubble = () => {
    const min = Number(spScale.min);
    const max = Number(spScale.max);
    const val = Number(spScale.value);
    const w = spScale.clientWidth || 120;
    const thumb = 12;
    const x = thumb / 2 + ((val - min) / (max - min)) * (w - thumb);
    spScaleVal.textContent = val + '%';
    spScaleVal.style.left = Math.round(x) + 'px';
  };

  moveBubble();
  spScale.addEventListener('input', () => {
    moveBubble();
    clearTimeout(scaleTimer);
    scaleTimer = setTimeout(async () => {
      settings = await window.desk.saveSettings({ uiScale: Number(spScale.value) / 100 });
    }, 220);
  });
  spScale.addEventListener('pointerdown', moveBubble);
}

/* ---------------- 每日提醒 ---------------- */

async function maybeNotify(reminding, now) {
  if (!reminding || !reminding.length) return;
  const today = dateStr(now);
  if (settings.lastNotifyDate === today) return;
  settings.lastNotifyDate = today;
  window.desk.saveSettings({ lastNotifyDate: today });
  const lines = reminding.slice(0, 3).map((t) => {
    const info = remindInfo(t, now);
    return tr('notify.line', {
      title: t.title,
      state: info.overdue ? tr('notify.overdue') : tr('notify.left', { n: info.daysLeft }),
    });
  });
  window.desk.notify({
    title: i18n.tCount('notify.title', reminding.length),
    body: lines.join('\n'),
  });
}

/* ---------------- 尺寸 ---------------- */
// 窗口固定尺寸，列表内部滚动（自适应高度会和窗口互相触发，已弃用）

/* ---------------- 启动 ---------------- */

(async function init() {
  try {
    const st = await window.desk.load();
    tasks = Array.isArray(st.tasks) ? st.tasks : [];
    settings = st.settings || {};
    const info = await window.desk.info();
    appVersion = info && info.version ? String(info.version) : '';
    if ($('#spVersion')) $('#spVersion').textContent = appVersion ? 'v' + appVersion : '-';
    applyFooter();

    settings.hotkey = settings.hotkey || 'Control+Alt+N';
    renderHotkeyLabel();

    // 语言先定下来（静态文案 + select 回显），真正的首屏渲染放到下面统一做
    applyLang(settings.lang || 'zh-CN', true);

    $('#ckAuto').checked = !!settings.autostart;
    $('#ckFullscreen').checked = settings.hideOnFullscreen !== false;
    initSettingsUI();
    syncBgAvailability();
    syncPluginOptions();
    applyTheme(settings.theme);
    applyBg(settings.bg, settings.bgCrop, settings.bgFade);
    let migrated = false;
    for (const t of tasks) {
      const n = normalizeTitle(t.title);
      if (n !== t.title) {
        t.title = n;
        migrated = true;
      }
    }
    if (migrated) persist();

    rollWeekly(new Date());
    render();
    if (location.hash === '#edit') openEditor(null);
    if (location.hash === '#mini') setMini(true);
    if (location.hash === '#settings') {
      $('#settingsPanel').hidden = false;
    }
  } catch (err) {
    console.error('初始化失败', err);
    $('#subText').textContent = tr('initFailed');
  }

  if (window.desk.onMiniState) window.desk.onMiniState((on) => applyMiniUI(on));

  // 卷起/放下：用 clip-path 在合成层做动画（跟随刷新率，不触发重排）
  if (window.desk.onRollAnimate) {
    window.desk.onRollAnimate((payload) => {
      const card = $('#card');
      const mode = payload && payload.mode;
      const cardH = card.offsetHeight || 582;
      const hidden = Math.max(0, cardH - 54);
      document.body.classList.add('rolling');
      window.dispatchEvent(new CustomEvent('desknote:roll', { detail: { rolling: true } }));
      card.style.transition = 'clip-path 200ms cubic-bezier(.22,.61,.36,1)';
      card.style.clipPath = mode === 'collapse' ? `inset(0 0 ${hidden}px 0)` : 'inset(0 0 0 0)';
    });
  }
  if (window.desk.onRollSettle) {
    window.desk.onRollSettle((payload) => {
      const card = $('#card');
      // 先切迷你/展开布局，再清 clip：两件事在同一帧完成，
      // 否则中间那一帧会露出整张卡片（迷你条「文字缺半截」的偶现渲染 bug）
      if (payload && typeof payload.mini === 'boolean') applyMiniUI(payload.mini);
      card.style.transition = 'none';
      card.style.clipPath = '';
      document.body.classList.remove('rolling');
      window.dispatchEvent(new CustomEvent('desknote:roll', { detail: { rolling: false } }));
    });
  }

  if (window.desk.onSettingsChanged) {
    window.desk.onSettingsChanged((s) => {
      settings = s || settings;
      $('#ckAuto').checked = !!settings.autostart;
      $('#ckFullscreen').checked = settings.hideOnFullscreen !== false;
      syncBgAvailability();
      if (settings.lang && settings.lang !== i18n.getLang()) applyLang(settings.lang);
      applyBg(settings.bg, settings.bgCrop, settings.bgFade);
      applyFooter();
      render();
    });
  }

  setInterval(() => {
    let migrated = false;
    for (const t of tasks) {
      const n = normalizeTitle(t.title);
      if (n !== t.title) {
        t.title = n;
        migrated = true;
      }
    }
    if (migrated) persist();

    rollWeekly(new Date());
    render();
  }, 30000);
})();
