// 事件 / 典故召回评测集生成（story-A018-02）：零 LLM、离线。
// 输入：sango 的 data/corpus/events.json（剔除 type=L3 行）、data/corpus/allusions.json、data/corpus/sanguo-yanyi/*.json
// 输出：test/standard-set/events/eval-set.json —— 每题含 ground truth chunkIds 组，供 test/events/events-recall-probe.mjs 判分
// 用法：node test/events/build-recall-eval.mjs [输出路径]；终端只打题数分布与落盘信息

import fs from 'node:fs';
import path from 'node:path';

const __dirname = import.meta.dirname;
const SANGO_DATA = process.env.SANGO_DATA_DIR ?? 'D:\\workplace\\mcp-server\\sango\\data';
const OUT = process.argv[2] ?? path.resolve(__dirname, '..', 'standard-set', 'events', 'eval-set.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** 语料 chunkId → { chapter, title }：判分只需回号；正文不进评测集。 */
function loadCorpus() {
  const dir = path.join(SANGO_DATA, 'corpus', 'sanguo-yanyi');
  const map = new Map();
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const ch = readJson(path.join(dir, name));
    for (const c of ch.chunks ?? []) map.set(c.chunk_id, { chapter: ch.chapter, title: ch.title });
  }
  return map;
}

const corpus = loadCorpus();
const events = readJson(path.join(SANGO_DATA, 'corpus', 'events.json'));
const allusions = readJson(path.join(SANGO_DATA, 'corpus', 'allusions.json'));

const rows = [];
const errors = [];
const seen = new Set();

for (const [source, list, skip] of [
  ['events', events.rows ?? [], (r) => r.type === 'L3'],
  ['allusions', allusions.rows ?? [], () => false],
]) {
  for (const r of list) {
    if (skip(r)) continue;
    const id = `${r.type}#${r.eventId}`;
    const chunkIds = (r.chunkIds ?? []).filter(Boolean);
    if (seen.has(id)) errors.push(`${id}: 重复`);
    seen.add(id);
    if (!r.eventName) errors.push(`${id}: eventName 为空`);
    if (!r.exampleQuestion) errors.push(`${id}: 无 exampleQuestion`);
    if (!chunkIds.length) errors.push(`${id}: chunkIds 为空`);
    const unknown = chunkIds.filter((c) => !corpus.has(c));
    if (unknown.length) errors.push(`${id}: chunkId 不在语料（${unknown.join(', ')}）`);
    const chapters = [...new Set(chunkIds.map((c) => corpus.get(c)?.chapter).filter((c) => c !== undefined))].sort((a, b) => a - b);
    rows.push({
      id,
      category: r.type,
      eventId: r.eventId,
      eventName: r.eventName,
      question: r.exampleQuestion,
      chunkIds,
      segCount: chunkIds.length,
      chapters,
      crossChapter: chapters.length > 1,
      firstChunk: chunkIds[0] ?? null,
      firstChapter: corpus.get(chunkIds[0])?.chapter ?? null,
      source,
    });
  }
}

if (errors.length) {
  console.error(`评测集校验失败 ${errors.length} 条：`);
  for (const e of errors.slice(0, 20)) console.error('  ✗', e);
  if (errors.length > 20) console.error(`  … 其余 ${errors.length - 20} 条`);
  process.exit(1);
}

const count = (list, keyFn) => {
  const acc = {};
  for (const r of list) acc[keyFn(r)] = (acc[keyFn(r)] ?? 0) + 1;
  return Object.entries(acc).map(([k, v]) => `${k}=${v}`).join(' / ');
};
const bucket = (n) => (n === 1 ? '单段' : n <= 10 ? '多段(2-10)' : '大组(>10)');

const out = {
  meta: {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      events: { normVersion: events.meta?.normVersion ?? '', corpusChunkCount: events.meta?.corpusChunkCount ?? 0 },
      allusions: { normVersion: allusions.meta?.normVersion ?? '' },
    },
    excluded: 'events.type=L3',
    total: rows.length,
  },
  rows,
};

console.log(`评测集题数 ${rows.length}（${count(rows, (r) => r.category)}）`);
console.log(`分档 ${count(rows, (r) => bucket(r.segCount))}；跨回 ${rows.filter((r) => r.crossChapter).length}`);

const writeSet = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
  console.log(`落盘 ${file}（${fs.statSync(file).size} 字节）`);
};

writeSet(OUT, out);
if (!process.argv[2]) {
  writeSet(path.resolve(path.dirname(OUT), 'eval-set-standard-name.json'), {
    meta: { ...out.meta, variant: 'standard-name', note: 'question = eventName（标准名直接提问）' },
    rows: rows.map((r) => ({ ...r, question: r.eventName })),
  });
}
