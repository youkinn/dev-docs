// rebuild-l3-anchors.mjs —— L3 行 chunkIds 重建为「标签位点段 ±N」口径（任务书 §1.1 Coco 前置，零 LLM）
// 用法：node test/events/rebuild-l3-anchors.mjs   （N 档位取 l3-anchor-overrides.mjs 的 L3_ANCHOR_N，v1 = 1）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { L3_ANCHOR_OVERRIDES, buildTagAnchorIndex, lookupTagAnchors, buildL3AnchorGroup } from './l3-anchor-overrides.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_ROOT = path.resolve(__dirname, '../../../mcp-server/sango');
const EVENTS = path.join(MCP_SERVER_ROOT, 'data/corpus/events.json');
const TAGS_PATH = path.join(MCP_SERVER_ROOT, 'data/corpus/tags/event.json');
const CORPUS_DIR = path.join(MCP_SERVER_ROOT, 'data/corpus/sanguo-yanyi');

const table = JSON.parse(fs.readFileSync(EVENTS, 'utf8'));
const tagsRaw = JSON.parse(fs.readFileSync(TAGS_PATH, 'utf8'));
const rows = table.rows || [];
const tagAnchors = buildTagAnchorIndex(tagsRaw);

const chunkIdsByHui = new Map();
for (let h = 1; h <= 120; h++) {
  const hui = String(h).padStart(3, '0');
  const doc = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, hui + '.json'), 'utf8'));
  chunkIdsByHui.set(hui, (doc.chunks || []).map((c) => c.chunk_id));
}

let changed = 0;
let overridden = 0;
const missing = [];
for (const r of rows) {
  if (r.type !== 'L3') continue;
  const hui = /^E(\d{3})/.exec(r.eventId)?.[1];
  let anchors = lookupTagAnchors(tagAnchors, hui, r.eventName);
  if (!anchors) {
    anchors = L3_ANCHOR_OVERRIDES[r.eventId] || null;
    if (anchors) overridden++;
  }
  if (!anchors) { missing.push(`${r.eventId} ${r.eventName}`); continue; }
  const group = buildL3AnchorGroup(anchors, chunkIdsByHui.get(hui) || []);
  if (JSON.stringify(group) !== JSON.stringify(r.chunkIds)) {
    r.chunkIds = group;
    changed++;
  }
}

if (missing.length) {
  console.log(`MISSING anchors (${missing.length}): ${missing.join(' ; ')}`);
  process.exit(1);
}

table.meta.normVersion = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 8);
table.meta.generatedAt = new Date().toISOString();
fs.writeFileSync(EVENTS, JSON.stringify(table, null, 2) + '\n', 'utf8');
const byType = {};
for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
console.log(`L3 重建完成：changed=${changed}（人工锚点 ${overridden}）rows=${rows.length} ${JSON.stringify(byType)} normVersion=${table.meta.normVersion}`);