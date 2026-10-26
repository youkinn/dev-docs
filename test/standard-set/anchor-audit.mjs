/**
 * bug-00052 证据锚可定位性审计（零 LLM）
 * 口径同源：直接复用 mcp-server sango/src/benchmark 的 parseBenchmark / norm，
 * 语料装载方式照抄 runner.findNoAnchorItems。
 * 用法: node --experimental-strip-types test/standard-set/anchor-audit.mjs [out.json]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBenchmark } from 'file:///D:/workplace/mcp-server/sango/src/benchmark/parser.ts';
import { norm } from 'file:///D:/workplace/mcp-server/sango/src/benchmark/matcher.ts';

const BENCH = fileURLToPath(new URL('../../docs/sango-rag-regression-benchmark_v0.1.md', import.meta.url));
const CORPUS = process.env.SANGO_CORPUS ?? 'D:/workplace/mcp-server/sango/data/corpus/sanguo-yanyi';
const OUT = process.argv[2] ?? fileURLToPath(new URL('bug-00052-anchor-audit.json', import.meta.url));

const byChapter = new Map();
for (const f of readdirSync(CORPUS)) {
  if (!f.endsWith('.json')) continue;
  const j = JSON.parse(readFileSync(join(CORPUS, f), 'utf8'));
  byChapter.set(j.chapter, { title: norm(j.title), texts: (j.chunks ?? []).map((c) => norm(c.text)) });
}
const titles = [...byChapter.values()].map((c) => c.title);
const allTexts = [...byChapter.values()].map((c) => c.texts.join('\n'));
const inBody = (a) => allTexts.some((t) => t.includes(a));

const items = parseBenchmark(BENCH);
const rows = items.map((it) => {
  const zero = it.textAnchors.length === 0 && it.titleAnchors.length === 0;
  const body = it.textAnchors.some(inBody);
  const title = it.titleAnchors.some((ta) => {
    const c = byChapter.get(ta.chapter);
    return !!c && c.title.includes(ta.title);
  });
  const fallbackAny = it.textAnchors.some((a) => a.length >= 4 && titles.some((t) => t.includes(a)));
  const fallback = fallbackAny && it.titleAnchors.length === 0;
  let cls;
  if (zero) cls = 'zero';
  else if (body) cls = 'body';
  else if (title) cls = 'title';
  else if (fallback) cls = 'fallback';
  else cls = 'dead';
  return { id: it.id, cls, body, title, fallback, fallbackAny, evidence: it.evidence, question: it.question, answer: it.answer };
});

const byCls = {};
for (const r of rows) (byCls[r.cls] ??= []).push(r.id);
writeFileSync(OUT, JSON.stringify({ bench: BENCH, total: rows.length, byCls, rows }, null, 1), 'utf8');

console.log(`total=${rows.length}`);
for (const k of ['body', 'title', 'fallback', 'zero', 'dead']) console.log(`${k}=${(byCls[k] ?? []).length}`);
console.log(`report=${OUT}`);
for (const k of ['zero', 'dead', 'fallback']) {
  console.log(`\n--- ${k} ---`);
  for (const r of rows.filter((r) => r.cls === k)) {
    console.log(`${r.id} | ${r.evidence.replace(/\s+/g, ' ').slice(0, 70)}`);
  }
}
