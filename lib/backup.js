'use strict';

/* ------------------------------------------------------------------
   备份轮转（不依赖 Electron，可用 node 测）
   - 每天一份快照：backups/state-YYYYMMDD.json，同名不覆盖
   - 只保留最近 keep 天，按文件名（=日期）排序，多余的删掉
   ------------------------------------------------------------------ */

const fs = require('node:fs');
const path = require('node:path');

const pad = (n) => String(n).padStart(2, '0');
const stampOf = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

function rotateBackup(stateFile, keep = 7, now = new Date()) {
  const result = { created: false, kept: 0, removed: [] };
  if (!fs.existsSync(stateFile)) return result;

  const dir = path.join(path.dirname(stateFile), 'backups');
  fs.mkdirSync(dir, { recursive: true });

  const dest = path.join(dir, `state-${stampOf(now)}.json`);
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(stateFile, dest);
    result.created = true;
  }

  const files = fs
    .readdirSync(dir)
    .filter((name) => /^state-\d{8}\.json$/.test(name))
    .sort();
  const drop = files.slice(0, Math.max(0, files.length - Math.max(1, keep)));
  for (const name of drop) {
    try {
      fs.unlinkSync(path.join(dir, name));
      result.removed.push(name);
    } catch {
      /* 删不掉就留着，不影响保存 */
    }
  }
  result.kept = files.length - result.removed.length;
  return result;
}

module.exports = { rotateBackup, stampOf };
