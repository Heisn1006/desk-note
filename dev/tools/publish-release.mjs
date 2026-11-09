#!/usr/bin/env node
'use strict';

/* DeskNote 发行助手：建 Release + 上传安装包，一条命令搞定。
 *
 * 用法：
 *   node dev/tools/publish-release.mjs 0.2.15              # 建/更新 v0.2.15 并上传附件
 *   node dev/tools/publish-release.mjs 0.2.15 --dry-run    # 只检查，不上传
 *   node dev/tools/publish-release.mjs                     # 用 package.json 里的版本
 *
 * 依赖：
 *   - 仓库里有 origin remote（用来推 owner/repo）
 *   - 凭据：优先 GITHUB_TOKEN 环境变量，否则从 `git credential fill` 取（Git Credential Manager 已授权过就行）
 *   - 安装包：DESKNOTE_SETUP_DIR\DeskNote-<ver>.setup.zip，没有就退回 dist\DeskNote-v<ver>-portable.zip
 *   - **凭据扫描**：上传前必须用 DSH 插件 dsh-leak-guard 的 leak_guard 扫一遍（仓库 + dist/DeskNote/resources/app），
 *     确认 ok=true 后设 LEAK_SCAN_OK=1；本脚本不带这个变量会直接拒绝上传（--dry-run 除外）。
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const __dirname = import.meta.dirname;

const ROOT = path.join(__dirname, '..', '..');
const DRY = process.argv.includes('--dry-run');

function log(msg) {
  console.log(msg);
}
function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

/* ---------------- 基本信息 ---------------- */

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = (process.argv[2] || pkg.version || '').replace(/^v/i, '').trim();
if (!version) die('没有版本号：`node dev/tools/publish-release.mjs 0.2.15`');

// 发版前必须先用 leak_guard 扫描（用户 2026-11-08 定的规矩）：
// 这个闸门故意做成「不设变量就停」，避免以后哪次顺手直接上传。
if (!DRY && process.env.LEAK_SCAN_OK !== '1') {
  die(
    '上传前先做凭据扫描：用 DSH 插件 dsh-leak-guard 的 leak_guard 扫描 desk-note 与 dist/DeskNote/resources/app，\n' +
      '确认 ok=true 后再设 LEAK_SCAN_OK=1 重跑本脚本（见交接文档 §7）。'
  );
}
log('✓ 凭据扫描闸门通过（LEAK_SCAN_OK=1）');

const tag = process.env.RELEASE_TAG || `v${version}`;
const TITLE = `DeskNote ${version}`;
// 优先用 CHANGELOG.md 里对应版本的小节
function changelogNotes() {
  try {
    const f = path.join(ROOT, 'CHANGELOG.md');
    if (!fs.existsSync(f)) return '';
    const text = fs.readFileSync(f, 'utf8');
    const re = new RegExp('^##\\s*v?' + version.replace(/\./g, '\\.') + '\\s*$', 'm');
    const m = text.match(re);
    if (!m) return '';
    const rest = text.slice(m.index + m[0].length);
    const next = rest.search(/^##\s/gm);
    return (next >= 0 ? rest.slice(0, next) : rest).trim();
  } catch {
    return '';
  }
}

const DEFAULT_NOTES = [
  `DeskNote ${version}`,
  '',
  '- 悬浮便签：任务 / 截止倒计时 / 每日提醒',
  '- 壁纸穿透插件：静态壁纸、Wallpaper Engine 视频壁纸、屏幕取景',
  '- 设置里的「检查更新」',
  '',
  '下载下面的安装包，解压后运行 `install.exe` 即可（会覆盖旧版本，任务和设置保留）。',
].join('\n');

const NOTES = process.env.RELEASE_NOTES || changelogNotes() || DEFAULT_NOTES;

if (version !== pkg.version) {
  log(`! 注意：package.json 是 ${pkg.version}，你要发的是 ${version}`);
}

/* ---------------- 安装包 ---------------- */

function setupDir() {
  return process.env.DESKNOTE_SETUP_DIR || 'D:\\DeskNote安装包';
}
const candidates = [
  path.join(setupDir(), `DeskNote-${version}.setup.zip`),
  path.join(ROOT, 'dist', `DeskNote-v${version}-portable.zip`),
];
const assetPath = candidates.find((p) => fs.existsSync(p));
if (!assetPath) {
  die(
    '找不到安装包，先打包：\n  node tools/publish-setup.js\n  或直接跑 dist 里的 Compress-Archive\n候选路径：\n  ' +
      candidates.join('\n  ')
  );
}
const assetName = path.basename(assetPath);
const assetSize = fs.statSync(assetPath).size;
log(`✓ 安装包 ${assetName}（${(assetSize / 1048576).toFixed(0)}MB）`);

/* ---------------- 仓库与凭据 ---------------- */

function repoSlug() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    if (m) return { owner: m[1], repo: m[2] };
  } catch {}
  return null;
}

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      cwd: ROOT,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const m = out.match(/^password=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return null;
}

const slug = repoSlug();
if (!slug) die('读不到 origin remote，先 `git remote add origin https://github.com/<you>/<repo>.git`');
const TK = token();
if (!TK) die('拿不到 GitHub 凭据：设置 GITHUB_TOKEN，或先用 Git 推送一次让凭据管理器记住');
log(`✓ 仓库 ${slug.owner}/${slug.repo}，tag ${tag}`);

/* ---------------- HTTP ---------------- */

function api(method, urlPath, bodyObj, host) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const req = https.request(
      {
        hostname: host || 'api.github.com',
        path: urlPath,
        method,
        headers: {
          Authorization: `token ${TK}`,
          'User-Agent': 'desknote-release',
          Accept: 'application/vnd.github+json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
      },
      (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => {
          let json = null;
          try {
            json = s ? JSON.parse(s) : null;
          } catch {}
          resolve({ status: res.statusCode, json, raw: s });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function uploadAsset(uploadUrl, name, file) {
  const size = fs.statSync(file).size;
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl.replace('{?name,label}', '') + `?name=${encodeURIComponent(name)}`);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          Authorization: `token ${TK}`,
          'User-Agent': 'desknote-release',
          'Content-Type': 'application/zip',
          'Content-Length': size,
        },
      },
      (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(s);
          } catch {}
          resolve({ status: res.statusCode, json, raw: s });
        });
      }
    );
    req.on('error', reject);
    const stream = fs.createReadStream(file);
    let sent = 0;
    let lastTick = Date.now();
    stream.on('data', (buf) => {
      sent += buf.length;
      if (Date.now() - lastTick > 5000) {
        lastTick = Date.now();
        log(`  … 已传 ${(sent / 1048576).toFixed(0)}/${(size / 1048576).toFixed(0)}MB`);
      }
    });
    stream.pipe(req);
    stream.on('error', reject);
    req.on('response', () => {});
  });
}

/* ---------------- 主流程 ---------------- */

(async () => {
  const base = `/repos/${slug.owner}/${slug.repo}`;

  // 1. 找已有 release（tag 命名可能不一致，比如历史遗留的 DeskNote-v0.2.14）
  let rel = await api('GET', `${base}/releases/tags/${encodeURIComponent(tag)}`);
  if (rel.status === 404) {
    const list = await api('GET', `${base}/releases?per_page=30`);
    const verRe = new RegExp(`v?${version.replace(/\./g, '\\.')}$`);
    const hit = (list.json || []).find((r) => r.tag_name && verRe.test(r.tag_name));
    if (hit) {
      rel = { status: 200, json: hit, raw: '' };
      log(`· 复用已有 release ${hit.tag_name}（tag 名和 v${version} 不一致，已自动匹配）`);
    }
  }
  if (rel.status === 404) {
    if (DRY) {
      log(`· [dry-run] 会新建 release ${tag}`);
      return;
    }
    rel = await api('POST', `${base}/releases`, {
      tag_name: tag,
      target_commitish: 'main',
      name: TITLE,
      body: NOTES,
    });
    if (rel.status >= 300) die(`建 release 失败 ${rel.status}: ${rel.raw.slice(0, 200)}`);
    log(`✓ 新建 release ${tag}`);
  } else if (rel.status >= 300) {
    die(`查 release 失败 ${rel.status}: ${rel.raw.slice(0, 200)}`);
  } else {
    log(`✓ release ${rel.json.tag_name || tag} 已存在（id=${rel.json.id}）`);
    if (process.env.RELEASE_NOTES || changelogNotes()) {
      const want = process.env.RELEASE_NOTES || changelogNotes();
      if (rel.json.body !== want) {
        const upd = await api('PATCH', `${base}/releases/${rel.json.id}`, { body: want });
        if (upd.status < 300) log('✓ 已同步 release 说明');
      }
    }
  }

  const releaseId = rel.json.id;

  // 1.5 更新检查用的版本清单：作为 release 附件同步一份。
  // 客户端的更新检查走 releases/latest/download/version.json（静态下载，不消耗 API 匿名额度）。
  const vfile = path.join(ROOT, "version.json");
  if (!DRY && fs.existsSync(vfile)) {
    const cur = await api("GET", `${base}/releases/${releaseId}/assets`);
    for (const a of (cur.json || []).filter((x) => x.name === "version.json")) {
      await api("DELETE", `/repos/${slug.owner}/${slug.repo}/releases/assets/${a.id}`);
    }
    const vu = await uploadAsset(rel.json.upload_url, "version.json", vfile);
    if (vu && vu.status < 300) log("✓ 已同步 version.json 附件（更新检查用）");
    else die("version.json 附件上传失败：" + String((vu && vu.raw) || "").slice(0, 160));
  } else if (DRY) {
    log("· [dry-run] 会同步 version.json 附件");
  }

  // 2. 同名附件：已上传的就跳过；卡在 starter 的先删掉
  const assets = await api('GET', `${base}/releases/${releaseId}/assets`);
  const same = (assets.json || []).filter((a) => a.name === assetName);
  for (const a of same) {
    if (a.state === 'uploaded') {
      log(`✓ 附件已存在且已完成：${a.browser_download_url}`);
      return;
    }
    log(`· 删掉未完成的附件记录 ${a.id}（state=${a.state}）`);
    if (!DRY) await api('DELETE', `/repos/${slug.owner}/${slug.repo}/releases/assets/${a.id}`);
  }

  if (DRY) {
    log(`· [dry-run] 会把 ${assetName} 传到 release ${releaseId}`);
    return;
  }

  // 3. 上传（网络会断，最多重试 3 次；每次重试前清掉残留的 starter 记录）
  const MAX_TRY = 3;
  let up = null;
  for (let attempt = 1; attempt <= MAX_TRY; attempt++) {
    log(`↑ 上传 ${assetName}（${(assetSize / 1048576).toFixed(0)}MB，第 ${attempt}/${MAX_TRY} 次）…`);
    try {
      up = await uploadAsset(rel.json.upload_url, assetName, assetPath);
      if (up && up.status < 300 && up.json && up.json.state === 'uploaded') break;
      log(`  第 ${attempt} 次失败：HTTP ${up && up.status} ${String((up && up.raw) || '').slice(0, 140)}`);
    } catch (e) {
      log(`  第 ${attempt} 次网络错误：${e.message}`);
      up = null;
    }
    const again = await api('GET', `${base}/releases/${releaseId}/assets`);
    for (const a of (again.json || []).filter((x) => x.name === assetName && x.state === 'starter')) {
      await api('DELETE', `/repos/${slug.owner}/${slug.repo}/releases/assets/${a.id}`);
    }
    if (attempt < MAX_TRY) await new Promise((r) => setTimeout(r, 5000));
  }
  if (!up || up.status >= 300 || !up.json) die('上传重试 ' + MAX_TRY + ' 次仍失败，过一会儿再跑一次同一条命令即可（会复用已有 release）');
  log(`✓ 上传完成 ${up.json.name}（state=${up.json.state}, ${(up.json.size / 1048576).toFixed(0)}MB）`);
  log(`  ${up.json.browser_download_url}`);
})().catch((e) => die(e && e.message ? e.message : String(e)));
