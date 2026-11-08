'use strict';

/* 导入/导出纯函数测试：node tools/data-check.js */

const assert = require('node:assert');
const data = require('../../lib/data.js');

let n = 0;
const ok = (cond, msg) => {
  n++;
  assert.ok(cond, msg);
};

/* ---------- sanitizeTask ---------- */

const good = data.sanitizeTask({
  id: 'abc_1',
  title: '  论文初稿（第三章）  ',
  done: 0,
  due: '2026-11-07T18:00',
  hasTime: 1,
  startAt: '2026-11-05T09:00',
  repeat: 'weekly',
  repeatDays: [1, 1, 5, 9, -2, '3'],
});
ok(good.id === 'abc_1', 'id 保留');
ok(good.title === '论文初稿（第三章）', '标题只去首尾空格，内容一字不改（全角括号保留）');
ok(good.done === false, 'done 转布尔');
ok(good.hasTime === true, 'hasTime 转布尔');
ok(good.due === '2026-11-07T18:00', '合法时间保留');
ok(JSON.stringify(good.repeatDays) === '[1,5,3]', '星期去重并过滤越界: ' + JSON.stringify(good.repeatDays));

ok(data.sanitizeTask(null) === null, 'null 丢弃');
ok(data.sanitizeTask('x') === null, '字符串丢弃');
ok(data.sanitizeTask({ title: '   ' }) === null, '空标题丢弃');
ok(data.sanitizeTask({ title: 'x', due: '2026-13-99T99:99' }).due === null, '非法日期置空但保留任务');
const badDue = data.sanitizeTask({ title: 'x', due: 'not-a-date', startAt: '2026/11/07' });
ok(badDue && badDue.due === null && badDue.startAt === null, '坏日期改 null 但保留任务');

const noId = data.sanitizeTask({ title: '无 id', id: '有 空格' });
ok(/^[A-Za-z0-9_-]{1,40}$/.test(noId.id), '非法 id 自动换新: ' + noId.id);
ok(noId.id !== '有 空格', '非法 id 不会原样保留');

const longTitle = data.sanitizeTask({ title: 'x'.repeat(data.MAX_TITLE + 50) });
ok(longTitle.title.length === data.MAX_TITLE, '超长标题截断到上限');

/* ---------- parseImport ---------- */

const fromObj = data.parseImport(
  JSON.stringify({ format: 'desknote', tasks: [{ id: 'a', title: '任务 A' }, { id: 'a', title: '重复 id' }, { title: '' }] })
);
ok(fromObj.ok === true, '对象格式可解析');
ok(fromObj.tasks.length === 1, '重复 id 与坏条目被过滤: ' + fromObj.tasks.length);

const fromArr = data.parseImport(JSON.stringify([{ id: 'b', title: '任务 B' }]));
ok(fromArr.ok && fromArr.tasks.length === 1, '裸数组也接受');

ok(data.parseImport('{oops').error === 'json', '坏 JSON 报 json');
ok(data.parseImport(JSON.stringify({ foo: 1 })).error === 'bad', '没有 tasks 报 bad');
ok(data.parseImport(JSON.stringify([])).ok === true, '空数组合法');

const tooMany = data.parseImport(JSON.stringify({ tasks: Array.from({ length: data.MAX_TASKS + 1 }, (_, i) => ({ id: 'x' + i, title: 't' })) }));
ok(tooMany.ok === false && tooMany.error === 'too-many', '超量报 too-many');

/* ---------- mergeTasks ---------- */

const existing = [{ id: 'a', title: '旧 A' }, { id: 'b', title: '旧 B' }];
const incoming = [{ id: 'a', title: '新 A（不该覆盖）' }, { id: 'c', title: '新 C' }, { id: 'd', title: '新 D' }];
const merged = data.mergeTasks(existing, incoming);
ok(merged.added === 2 && merged.skipped === 1, `合并计数 added=${merged.added} skipped=${merged.skipped}`);
ok(merged.tasks[0].id === 'c' && merged.tasks[1].id === 'd', '新任务排在前面');
ok(merged.tasks.find((t) => t.id === 'a').title === '旧 A', '同 id 绝不覆盖旧任务');
ok(merged.tasks.length === 4, '总数 = 旧 + 新');

/* ---------- 导出 → 导入 往返：标题逐字不变 ---------- */

const tricky = [
  '论文初稿（第三章）',
  'CET-4 考试（准考证记得带）',
  'Weekly 周报 · 第 12 期',
  '  前后有空格  ',
  'emoji 🔔 也算标题',
  'A</script><b>x</b>',
];
const originals = tricky.map((title, i) => ({
  id: 'r' + i,
  title,
  done: i % 2 === 0,
  due: '2026-11-0' + (i + 1) + 'T18:0' + i,
  hasTime: true,
  startAt: null,
  repeat: '',
  repeatDays: [],
  createdAt: '2026-11-01T09:00',
}));
const exported = data.buildExport(originals, '0.1.3');
ok(exported.format === 'desknote' && exported.schema === 1, '导出带格式标记');
ok(exported.version === '0.1.3', '导出带版本号');

const back = data.parseImport(JSON.stringify(exported));
ok(back.ok && back.tasks.length === originals.length, '往返条数一致');
back.tasks.forEach((t, i) => {
  const expect = originals[i].title.trim();
  ok(t.title === expect, `往返标题不一致: [${expect}] -> [${t.title}]`);
});
ok(
  back.tasks.some((t) => t.title === 'A</script><b>x</b>'),
  '标签样文本原样保留（渲染层负责转义，导入层不得改写）'
);

console.log(`✓ 数据层测试通过（${n} 项断言）`);
