import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// verify-events.mjs —— A018 事件表硬校验（验收 1；校验口径与老陈接口文档 §1.5 V1–V7 对齐）
// 用法：node test/events/verify-events.mjs

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_ROOT = path.resolve(__dirname, '../../../mcp-server/sango');
const EVENTS = path.join(MCP_SERVER_ROOT, 'data/corpus/events.json');
const CORPUS_DIR = path.join(MCP_SERVER_ROOT, 'data/corpus/sanguo-yanyi');
const ENTITY_PATH = path.join(MCP_SERVER_ROOT, 'data/entity-table.json');
const GAP = path.join(__dirname, 'gap.md');
const FIRST_PASS = path.join(__dirname, 'first-pass.md');

const errors = [];
const warnings = [];

const table = JSON.parse(fs.readFileSync(EVENTS, 'utf8'));
const meta = table.meta || {};
const rows = table.rows || [];

const corpusChunks = new Set();
for (let h = 1; h <= 120; h++) {
  const hui = String(h).padStart(3, '0');
  const doc = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, hui + '.json'), 'utf8'));
  for (const c of doc.chunks || []) corpusChunks.add(c.id);
}

const entity = JSON.parse(fs.readFileSync(ENTITY_PATH, 'utf8'));
const rewriteKeys = new Set((entity.rows || []).flatMap((r) => r.rewriteKeys || []));

const gapText = fs.readFileSync(GAP, 'utf8');
const crossRecords = new Map();
const crossSection = gapText.split('## 二审跨回复核记录')[1] || '';
for (const line of crossSection.split(/\r?\n/)) {
  const m = line.match(/^\|\s*(\d{3})\s*\|\s*([^|]+?)\s*\|\s*(\d{3})\s*[\u2013\u2014-]\s*(\d{3})\s*\|/);
  if (m) crossRecords.set(m[1] + '|' + m[2], m[3] + '\u2013' + m[4]);
}

// ---- V7 meta ----
if (!meta.normVersion || !meta.corpusChunkCount) errors.push('V7: meta 缺 normVersion / corpusChunkCount');
else {
  const re = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 8);
  if (re !== meta.normVersion) errors.push('V7: meta.normVersion=' + meta.normVersion + ' 与 rows 内容重算 ' + re + ' 不一致');
  if (meta.corpusChunkCount !== corpusChunks.size) warnings.push('V7: meta.corpusChunkCount=' + meta.corpusChunkCount + ' 与当前语料 chunks=' + corpusChunks.size + ' 不一致（重建漂移信号）');
}

// ---- 行级校验 ----
const seenEventId = new Set();
const seenNameHui = new Set();
const globalAliases = new Map();
const reportedDups = new Set();
const huiCover = new Set();

for (const r of rows) {
  const huiFromId = /^E(\d{3})/.exec(r.eventId || '');
  if (!r.eventId) errors.push('V1: 空 eventId');
  else if (seenEventId.has(r.eventId)) errors.push('V1: eventId 重复 ' + r.eventId);
  seenEventId.add(r.eventId);

  if (!r.eventName) errors.push((r.eventId || '?') + ': V2 eventName 为空');
  if (huiFromId) {
    const k = huiFromId[1] + '|' + r.eventName;
    if (seenNameHui.has(k)) errors.push('V2: 同回事件名重复 ' + k);
    seenNameHui.add(k);
    huiCover.add(huiFromId[1]);
  }

  if (!['L1', 'L2', 'L3'].includes(r.type)) errors.push(r.eventId + ': V5 type=' + r.type + ' 非法');
  if (!Array.isArray(r.aliases) || r.aliases.length === 0) errors.push(r.eventId + ': V3 aliases 为空');
  else {
    const inRow = new Set();
    for (const a of r.aliases) {
      if (typeof a !== 'string' || a.length < 2) errors.push(r.eventId + ': V3 alias「' + a + '」长度 < 2');
      if (inRow.has(a)) errors.push(r.eventId + ': V3 行内 alias 重复「' + a + '」');
      inRow.add(a);
      if (globalAliases.has(a)) {
        const pair = [globalAliases.get(a), r.eventId].sort().join(' / ');
        const dupKey = pair;
        if (!reportedDups.has(dupKey)) {
          warnings.push('V3: alias「' + a + '」跨行重复（' + pair + '）——重名/同实，桥按接口 §3.2 组优先级取');
          reportedDups.add(dupKey);
        }
      }
      globalAliases.set(a, r.eventId);
      if (rewriteKeys.has(a)) errors.push('V3: alias「' + a + '」与实体表 rewriteKeys 冲突（' + r.eventId + '）');
    }
  }

  if (!Array.isArray(r.chunkIds) || r.chunkIds.length === 0) errors.push(r.eventId + ': V4 chunkIds 为空（待核事件未落表）');
  else {
    for (const cid of r.chunkIds) {
      if (!corpusChunks.has(cid)) errors.push('V4: chunkId 不存在于语料 ' + cid + '（' + r.eventId + '）');
    }
  }

  if (r.exampleQuestion === undefined || r.exampleQuestion === '') warnings.push(r.eventId + ': exampleQuestion 为空');

  if (r.crossChapter) {
    const k = (huiFromId ? huiFromId[1] : '') + '|' + r.eventName;
    const expect = crossRecords.get(k);
    if (!expect) errors.push('V6: 跨回事件无复核记录 ' + r.eventName + '（gap.md 跨回表缺 ' + k + '）');
    else if (expect !== r.crossChapter) errors.push('V6: 跨回区间不符 ' + r.eventName + ' 表内=' + r.crossChapter + ' gap=' + expect);
  }
}

for (const [k, v] of crossRecords) {
  const hit = rows.find((r) => (r.eventId || '').startsWith('E' + k.split('|')[0]) && r.eventName === k.split('|')[1]);
  if (!hit) errors.push('V6: gap 跨回记录 ' + k + '（' + v + '）在事件表中无对应行');
}

// ---- 全集完整性 ----
const firstPassRows = fs.readFileSync(FIRST_PASS, 'utf8').split(/\r?\n/).filter((l) => /^\|\s*\d{3}\s*\|/.test(l)).length;
const total = rows.length;
// 分层全集口径（初审任务书 first-pass-spec.md：L1≈90 / L2≈150 / L3≈480，宁多勿漏），总量 ≥ 400 即合规
if (total < 400) errors.push('验收 1: 事件总数 ' + total + ' < 400（宁多勿漏下限）');
console.log('总量 ' + total + ' ≥ 400 ✓');
if (total < firstPassRows - 1) errors.push('全集完整性: 期望 ≥ ' + (firstPassRows - 1) + '（初审 ' + firstPassRows + ' 条 − 待核 1），实际 ' + total);
for (let h = 1; h <= 120; h++) {
  const hui = String(h).padStart(3, '0');
  if (!huiCover.has(hui)) errors.push('全集完整性: 回 ' + hui + ' 无任何事件（120 回覆盖要求）');
}
const byType = {};
for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;

console.log('rows:', total, JSON.stringify(byType));
console.log('跨回事件:', rows.filter((r) => r.crossChapter).length, '; gap 跨回记录:', crossRecords.size);
console.log('----');
if (errors.length) {
  console.log('FAIL');
  for (const e of errors.slice(0, 40)) console.log('  ✗', e);
  if (errors.length > 40) console.log('  … 其余', errors.length - 40, '条');
  process.exit(1);
}
console.log('PASS');
if (warnings.length) {
  for (const w of warnings.slice(0, 20)) console.log('  ⚠', w);
  if (warnings.length > 20) console.log('  … 其余', warnings.length - 20, '条告警');
}