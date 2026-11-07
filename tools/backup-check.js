'use strict';

/* 备份轮转测试：node tools/backup-check.js */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const backup = require('../lib/backup.js');

let n = 0;
const ok = (cond, msg) => {
  n++;
  assert.ok(cond, msg);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desknote-backup-'));
const stateFile = path.join(root, 'state.json');
const dir = path.join(root, 'backups');

const write = (name, body) => fs.writeFileSync(path.join(dir, name), body, 'utf8');
const names = () => fs.readdirSync(dir).sort();

/* 1. state.json 不存在：什么都不做 */
ok(backup.rotateBackup(stateFile, 7).created === false, '没有 state.json 时不创建备份');
ok(!fs.existsSync(dir), '没有 state.json 时不创建目录');

/* 2. 首次轮转：复制当天快照 */
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(stateFile, '{"v":1}', 'utf8');
const r1 = backup.rotateBackup(stateFile, 7, new Date(2026, 10, 7));
ok(r1.created === true, '首次创建当天快照');
ok(names().includes('state-20261107.json'), '快照文件名带日期: ' + names());
ok(fs.readFileSync(path.join(dir, 'state-20261107.json'), 'utf8') === '{"v":1}', '快照内容 = 当前 state');

/* 3. 同一天再保存：不覆盖已有快照 */
fs.writeFileSync(stateFile, '{"v":2}', 'utf8');
const r2 = backup.rotateBackup(stateFile, 7, new Date(2026, 10, 7));
ok(r2.created === false, '同一天不重复创建');
ok(fs.readFileSync(path.join(dir, 'state-20261107.json'), 'utf8') === '{"v":1}', '当天快照保持第一次的内容');

/* 4. 超过 keep 天：只留最近 7 份 */
for (let d = 1; d <= 9; d++) write(`state-2026100${d}.json`, `old-${d}`);
const r3 = backup.rotateBackup(stateFile, 7, new Date(2026, 10, 7));
ok(r3.removed.length === 3, `应删掉 3 份旧快照，实际 ${r3.removed.length}: ${r3.removed}`);
ok(r3.kept === 7, `保留 7 份，实际 ${r3.kept}`);
ok(!fs.existsSync(path.join(dir, 'state-20261001.json')), '最旧的被删');
ok(!fs.existsSync(path.join(dir, 'state-20261002.json')), '次旧的被删');
ok(!fs.existsSync(path.join(dir, 'state-20261003.json')), '第三旧的被删');
ok(fs.existsSync(path.join(dir, 'state-20261004.json')), '边界（第 7 新）保留');
ok(fs.existsSync(path.join(dir, 'state-20261107.json')), '当天快照保留');

/* 5. 再跑一次是幂等的 */
const before = names().join(',');
const r4 = backup.rotateBackup(stateFile, 7, new Date(2026, 10, 7));
ok(r4.removed.length === 0 && before === names().join(','), '重复调用不改变文件集合');

/* 6. 杂项文件不参与轮转 */
write('notes.txt', 'x');
write('state-20261399.json', 'x'); // 格式像但不是合法日期，仍按文件名处理（只做数量控制）
const r5 = backup.rotateBackup(stateFile, 7, new Date(2026, 10, 8));
ok(fs.existsSync(path.join(dir, 'notes.txt')), '无关文件不会被误删');

/* 7. keep=1 也只保留一天 */
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'desknote-backup2-'));
const state2 = path.join(root2, 'state.json');
fs.writeFileSync(state2, '{}', 'utf8');
for (let d = 1; d <= 3; d++) {
  fs.mkdirSync(path.join(root2, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(root2, 'backups', `state-2026100${d}.json`), 'x');
}
backup.rotateBackup(state2, 1, new Date(2026, 10, 7));
ok(fs.readdirSync(path.join(root2, 'backups')).length === 1, 'keep=1 时只剩当天一份');

console.log(`✓ 备份轮转测试通过（${n} 项断言）`);
