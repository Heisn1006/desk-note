'use strict';

/* ------------------------------------------------------------------
   导入 / 导出用的纯函数（不依赖 Electron，可直接用 node 测）
   - 导出：DeskNote 自己的文件格式，带 format/schema/version 标记
   - 导入：兼容 { tasks: [...] } 与裸数组；逐条清洗，坏数据丢弃
   - 合并：按 id 去重，只加新任务，绝不覆盖/删除已有任务
   ------------------------------------------------------------------ */

const FORMAT = 'desknote';
const SCHEMA = 1;
const MAX_TASKS = 5000;
const MAX_TITLE = 500;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const cleanDate = (v) => {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return null;
  return Number.isNaN(+new Date(v)) ? null : v;
};

const randomId = () => Math.random().toString(36).slice(2, 9);

const cleanId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : randomId());

function sanitizeTask(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;
  const repeatDays = Array.isArray(raw.repeatDays)
    ? [...new Set(raw.repeatDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
    : [];
  return {
    id: cleanId(raw.id),
    title: title.slice(0, MAX_TITLE),
    done: !!raw.done,
    due: cleanDate(raw.due),
    hasTime: !!raw.hasTime,
    startAt: cleanDate(raw.startAt),
    repeat: raw.repeat === 'weekly' ? 'weekly' : '',
    repeatDays,
    createdAt: cleanDate(raw.createdAt) || new Date().toISOString(),
    doneAt: cleanDate(raw.doneAt),
    nextAt: cleanDate(raw.nextAt),
    nextStartAt: cleanDate(raw.nextStartAt),
  };
}

// 接受文件文本，返回 { ok, tasks } 或 { ok:false, error:'json'|'bad'|'too-many' }
function parseImport(text) {
  let raw;
  try {
    raw = JSON.parse(String(text || ''));
  } catch {
    return { ok: false, error: 'json' };
  }
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.tasks) ? raw.tasks : null;
  if (!list) return { ok: false, error: 'bad' };
  if (list.length > MAX_TASKS) return { ok: false, error: 'too-many' };

  const tasks = [];
  const seen = new Set();
  for (const item of list) {
    const t = sanitizeTask(item);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    tasks.push(t);
  }
  return { ok: true, tasks };
}

function buildExport(tasks, version) {
  return {
    format: FORMAT,
    schema: SCHEMA,
    app: 'DeskNote',
    version: String(version || ''),
    exportedAt: new Date().toISOString(),
    tasks: Array.isArray(tasks) ? tasks : [],
  };
}

// 导入合并：新任务在前，与「新建任务 unshift」的顺序一致
function mergeTasks(existing, incoming) {
  const have = new Set((existing || []).map((t) => t.id));
  const fresh = [];
  for (const t of incoming || []) {
    if (have.has(t.id)) continue;
    have.add(t.id);
    fresh.push(t);
  }
  return {
    tasks: fresh.concat(existing || []),
    added: fresh.length,
    skipped: (incoming || []).length - fresh.length,
  };
}

module.exports = { FORMAT, SCHEMA, MAX_TASKS, MAX_TITLE, sanitizeTask, parseImport, buildExport, mergeTasks };
