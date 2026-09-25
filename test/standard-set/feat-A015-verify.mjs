#!/usr/bin/env node
/**
 * feat-A015 标准集验证脚本 v2（零 LLM，全新实现，不沿用任何旧评测脚本）
 *
 * 用途：每次回归执行一遍评测集——加载真实检索（SangoIndex：向量+BM25+标签融合），
 *       逐题判断「证据段是否进 top5 / 6–10 兜底 / 未命中」，结果快照落盘。
 *
 * 判分口径（评测集头部定义）：判对 = 答案（证据）段进入检索结果 top5；
 *       6–10 为过渡兜底、单列统计；其余为未命中。
 *
 * 匹配引擎：证据锚 = 证据列引号内原文片段（自动去除引号内括注）；匹配时对语料/条目文本
 *       做中文标点归一化（防引文标点差异）；片段优先匹配正文，回目类文本回退匹配回目 title。
 *
 * 用法：
 *   node --experimental-strip-types feat-A015-verify.mjs
 * 环境变量：
 *   SANGO_DIR    sango 包路径（默认 工作区根/mcp-server/sango）
 *   BENCH_MD     评测集路径（默认 dev-docs/docs/sango-rag-regression-benchmark_v0.1.md）
 *   OUT_DIR      结果输出目录（默认 本脚本目录/results）
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEV_DOCS_ROOT = resolve(HERE, '..', '..');
const WORKSPACE_ROOT = resolve(DEV_DOCS_ROOT, '..');
const SANGO_DIR = resolve(process.env.SANGO_DIR ?? resolve(WORKSPACE_ROOT, 'mcp-server', 'sango'));
const BENCH_MD = resolve(process.env.BENCH_MD ?? resolve(DEV_DOCS_ROOT, 'docs', 'sango-rag-regression-benchmark_v0.1.md'));
const OUT_DIR = resolve(process.env.OUT_DIR ?? resolve(HERE, 'results'));
const CORPUS_DIR = resolve(SANGO_DIR, 'data', 'corpus', 'sanguo-yanyi');

function fail(msg) { console.error(`[feat-A015] ${msg}`); process.exit(1); }
if (!existsSync(BENCH_MD)) fail(`评测集不存在：${BENCH_MD}`);
const indexEntry = resolve(SANGO_DIR, 'src', 'search', 'sango-index.ts');
if (!existsSync(indexEntry)) fail(`检索入口不存在：${indexEntry}（可用 SANGO_DIR 覆盖）`);

const CATEGORIES = ['人物', '地名', '战役', '典故', '器物', '身体部位', '官职', '数字称谓', '事件关系', '死亡', '拒答'];
const CATEGORY_LABEL = { 人物: '人物', 地名: '地名', 战役: '战役', 典故: '典故', 器物: '器物', 身体部位: '身体部位', 官职: '官职/爵位', 数字称谓: '数字称谓', 事件关系: '事件关系', 死亡: '死亡', 拒答: '拒答' };

/** 中文标点归一化：去标点/空白，用于抗引文标点差异 */
function norm(s) {
  return s.replace(/[，。、；：？！“”‘’（）《》〈〉…\s,.;:?!()'"\-—~·]/g, '');
}

function extractAnchors(evidence) {
  const textAnchors = [];
  const titleAnchors = [];
  const chapterRefs = [];
  for (const m of evidence.matchAll(/第(\d+)回目?\s*[：:]/g)) chapterRefs.push(Number(m[1]));
  for (const m of evidence.matchAll(/“([^”]+)”/g)) {
    for (const seg of m[1].split(/…|\.\.\./)) {
      const cleaned = seg.replace(/（[^）]*）/g, '').trim();
      if (cleaned.length >= 2) textAnchors.push(cleaned);
      // 句读拆分短语：长锚失配时可回退短语（≥4 字）
      for (const phrase of cleaned.split(/[，。；、？！]/)) {
        const ph = phrase.trim();
        if (ph.length >= 4) textAnchors.push(ph);
      }
    }
  }
  for (const m of evidence.matchAll(/第(\d+)回目\s*[：:]\s*“([^”]+)”/g)) {
    titleAnchors.push({ chapter: Number(m[1]), title: m[2].trim() });
  }
  return {
    textAnchors: [...new Set(textAnchors.map(norm))].filter(Boolean),
    titleAnchors: [...new Set(titleAnchors.map(a => `${a.chapter}|${a.title}`))].map(s => { const [c, ...rest] = s.split('|'); return { chapter: Number(c), title: rest.join('|') }; }),
    chapterRefs: [...new Set(chapterRefs)],
  };
}

function parseBenchmark(mdPath) {
  const lines = readFileSync(mdPath, 'utf8').split(/\r?\n/);
  const items = [];
  let category = '';
  for (const line of lines) {
    const sec = line.match(/^##\s+(.+)$/);
    if (sec) {
      const catRaw = sec[1].replace(/^[一二三四五六七八九十]+、?\s*/, '').trim();
      const cat = CATEGORIES.find(c => catRaw.startsWith(c));
      if (cat) category = cat;
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    if (!/^\d+$/.test(cells[1])) continue;
    const question = cells[2];
    const answer = cells[3];
    const evidence = cells[cells.length - 2];
    if (!question || !evidence) continue;
    items.push({ id: `${category}#${cells[1]}`, category, num: Number(cells[1]), question, answer, evidence, ...extractAnchors(evidence) });
  }
  return items;
}

function loadCorpus() {
  const chapters = [];
  for (let i = 1; i <= 120; i++) {
    const f = resolve(CORPUS_DIR, `${String(i).padStart(3, '0')}.json`);
    if (!existsSync(f)) continue;
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    chapters.push({ chapter: doc.chapter, title: norm(doc.title), allText: norm(doc.chunks.map(c => c.text).join('\n')) });
  }
  return chapters;
}

const items = parseBenchmark(BENCH_MD);
console.error(`[feat-A015] 评测集解析：${items.length} 题`);

// 锚有效性校验（零 LLM：答案是否真在演义中出现、证据是否可定位）
const chapters = loadCorpus();
const noAnchor = [];
for (const it of items) {
  if (it.textAnchors.length === 0 && it.titleAnchors.length === 0) continue; // 说明型/负例证据
  let ok = false;
  for (const a of it.textAnchors) {
    if (chapters.some(c => c.allText.includes(a))) { ok = true; break; }
  }
  if (!ok) {
    for (const ta of it.titleAnchors) {
      const ch = chapters.find(c => c.chapter === ta.chapter);
      if (ch && ch.title.includes(ta.title)) { ok = true; break; }
    }
  }
  if (!ok) {
    for (const a of it.textAnchors) {
      if (a.length >= 4 && chapters.some(c => c.title.includes(a))) { ok = true; break; }
    }
  }
  if (!ok) noAnchor.push(it.id);
}

// 真实检索
const { SangoIndex } = await import(pathToFileURL(indexEntry).href);
const index = new SangoIndex();
index.load();
console.error(`[feat-A015] 索引加载完成：${index.n} chunk`);

const INFER_LIMIT = 50;
const results = [];
for (const it of items) {
  const res = await index.search(it.question, INFER_LIMIT);
  let rank = 0;
  let hit = null;
  // 1) 正文匹配（归一化后子串）
  outer: for (let i = 0; i < res.entries.length; i++) {
    const nt = norm(res.entries[i].text);
    for (const a of it.textAnchors) {
      if (nt.includes(a)) { rank = i + 1; hit = res.entries[i]; break outer; }
    }
  }
  // 2) 回目标题匹配：显式回目锚（限定回号）优先，其次任意回 title 含锚段（≥4 字）
  if (rank === 0) {
    for (let i = 0; i < res.entries.length; i++) {
      const e = res.entries[i];
      const nTitle = norm(e.title);
      let matched = false;
      for (const ta of it.titleAnchors) {
        if (e.chapter === ta.chapter && nTitle.includes(ta.title)) { matched = true; break; }
      }
      if (!matched && it.titleAnchors.length === 0) {
        for (const a of it.textAnchors) {
          if (a.length >= 4 && nTitle.includes(a)) { matched = true; break; }
        }
      }
      if (matched) { rank = i + 1; hit = e; break; }
    }
  }
  let status = 'miss';
  if (rank >= 1 && rank <= 5) status = 'top5';
  else if (rank >= 6 && rank <= 10) status = 'tail';
  results.push({
    id: it.id, question: it.question, answer: it.answer, evidence: it.evidence,
    textAnchors: it.textAnchors, titleAnchors: it.titleAnchors, chapterRefs: it.chapterRefs,
    rank, status,
    hit: hit ? { id: hit.id, chapter: hit.chapter, title: hit.title, text: hit.text.slice(0, 80) } : null,
    candidates: res.entries.slice(0, 10).map(e => ({ id: e.id, chapter: e.chapter, title: e.title })),
  });
}

const byStatus = { top5: 0, tail: 0, miss: 0 };
for (const r of results) byStatus[r.status]++;
const top3 = results.filter(r => r.rank >= 1 && r.rank <= 3).length;
const top10 = results.filter(r => r.rank >= 1 && r.rank <= 10).length;
const inPool = results.filter(r => r.rank > 0).length;

const byCategory = {};
for (const r of results) {
  const catKey = r.id.split('#')[0];
  byCategory[catKey] ||= { total: 0, top5: 0, tail: 0, miss: 0 };
  byCategory[catKey].total++;
  byCategory[catKey][r.status]++;
}

const stamp = new Date();
const pad = n => String(n).padStart(2, '0');
const stampStr = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
mkdirSync(OUT_DIR, { recursive: true });
const outFile = resolve(OUT_DIR, `feat-A015-${stampStr}.json`);
const summary = {
  tool: 'feat-A015-verify.mjs', version: 'v2', time: stamp.toISOString(), benchmark: BENCH_MD,
  engine: { sango: SANGO_DIR, indexN: index.n, inferLimit: INFER_LIMIT },
  total: results.length, top5: byStatus.top5, tail: byStatus.tail, miss: byStatus.miss,
  top3, top10, inPool50: inPool, noAnchorCount: noAnchor.length, noAnchor,
  category: byCategory, runId: `feat-A015-${stampStr}`,
};
writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2), 'utf8');

// —— 配套汇总 md：复制评测集「十三、回归测试结果」表结构填本次数字（源表保持模板不动）
//    并列明 6–10 兜底 / 10 以后未命中的问题编号，供回归结果汇总直接取用。
const catRows = Object.entries(byCategory).map(
  ([cat, v]) => `| ${CATEGORY_LABEL[cat] ?? cat} | ${v.total} | ${v.top5} | ${v.tail} | ${v.miss} | ${(v.top5 / v.total * 100).toFixed(1)}% |`,
);
const totalRow = `| **合计** | **${results.length}** | **${byStatus.top5}** | **${byStatus.tail}** | **${byStatus.miss}** | **${(byStatus.top5 / results.length * 100).toFixed(1)}%** |`;
const tableBody = ['| 类别 | 总题数 | 通过数(top5) | 兜底数(6–10) | 未命中数 | 通过率 |', '|---|---:|---:|---:|---:|---:|', ...catRows, totalRow].join('\n');
const tailList = results.filter(r => r.status === 'tail').map(r => `| ${r.id} | ${r.question} | rank=${r.rank} |`).join('\n');
const missList = results.filter(r => r.status === 'miss').map(r => `| ${r.id} | ${r.question} | ${r.rank >= 1 ? `rank=${r.rank}` : '未召回'} |`).join('\n');
const summaryFile = resolve(OUT_DIR, `feat-A015-${stampStr}-summary.md`);
writeFileSync(summaryFile, [
  `# FEAT-A015 回归测试结果（${stampStr}）`,
  '',
  '> 引擎 SangoIndex（向量+BM25+标签融合，limit=50）；零 LLM；判对 = 证据段进 top5，6–10 兜底，其余未命中。',
  `> JSON 快照：\`${outFile}\``,
  '',
  '## 回归测试结果（十三段模板 COPY）',
  '',
  tableBody,
  '',
  '## 兜底问题（rank 6–10）',
  '',
  '| 编号 | 问题 | 结果 |',
  '|---|---|---|',
  tailList || '（无）',
  '',
  '## 未命中问题（rank >10 或未召回）',
  '',
  '| 编号 | 问题 | 结果 |',
  '|---|---|---|',
  missList || '（无）',
  '',
].join('\n'), 'utf8');
console.log(`   汇总文件    ${summaryFile}`);

console.log('==== feat-A015 评测集回归 =========================================================');
console.log(`   时间         ${stampStr}    引擎 SangoIndex（向量+BM25+标签融合，limit=${INFER_LIMIT}）`);
console.log(`   总题         ${results.length}`);
console.log(`   判对 top5     ${byStatus.top5}   (${(byStatus.top5 / results.length * 100).toFixed(1)}%)`);
console.log(`   兜底 6–10     ${byStatus.tail}`);
console.log(`   未命中        ${byStatus.miss}`);
console.log(`   top≤3        ${top3}   top≤10 ${top10}   入50路池 ${inPool}`);
console.log(`   结果快照      ${outFile}`);
console.log(`\n[类别汇总]（可粘贴至评测集「十三、回归测试结果」）`);
console.log('| 类别 | 总题数 | 通过数(top5) | 兜底数(6–10) | 未命中数 | 通过率 |');
let cTotal = 0, cTop5 = 0, cTail = 0, cMiss = 0;
for (const [cat, v] of Object.entries(byCategory)) {
  cTotal += v.total; cTop5 += v.top5; cTail += v.tail; cMiss += v.miss;
  console.log(`| ${CATEGORY_LABEL[cat] ?? cat} | ${v.total} | ${v.top5} | ${v.tail} | ${v.miss} | ${(v.top5 / v.total * 100).toFixed(1)}% |`);
}
console.log(`| **合计** | **${cTotal}** | **${cTop5}** | **${cTail}** | **${cMiss}** | **${(cTop5 / cTotal * 100).toFixed(1)}%** |`);
if (noAnchor.length) {
  console.log(`\n[警告] 证据锚在语料中无法定位（评测集问题，需修）：`);
  for (const id of noAnchor) console.log(`   - ${id}`);
}
const problems = results.filter(r => r.status !== 'top5');
if (problems.length) {
  console.log(`\n[明细] 未判对（top5 以外）${problems.length} 题：`);
  for (const r of problems) {
    console.log(`   ${r.id} | rank=${r.rank === 0 ? '未召回' : r.rank} | ${r.question.slice(0, 36)}`);
  }
}
