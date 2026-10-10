// 事件 / 典故组召回探针（story-A018-02）：零 LLM、离线；不改检索链路与运行期口径。
// 判分单位 = 事件 / 典故的 chunkIds 组：hit@k = top-k 含组内任一段；firstRank = 组内首段排名（0 = 未进 50 路池）。
// 用法：node test/events/events-recall-probe.mjs [--limit N]（前置：sango 侧 npm run build）
// 落盘：test/standard-set/events/results/events-recall-YYYY-MM-DD-HHMM.json 与 -summary.md；自动与上一份快照逐题比环比

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '..', '..', '..');
const SANGO_DIR = path.resolve(process.env.SANGO_DIR ?? path.resolve(ROOT, 'mcp-server', 'sango'));
const EVAL_SET = process.env.SANGO_EVENTS_EVAL ?? path.resolve(HERE, '..', 'standard-set', 'events', 'eval-set.json');
const RESULTS_DIR = process.env.SANGO_EVENTS_RESULTS_DIR ?? path.resolve(path.dirname(EVAL_SET), 'results');
const INFER_LIMIT = 50;

const argv = process.argv.slice(2);
const limitIdx = argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : Infinity;

/** 档位序：用于环比判退化 / 改善。 */
const STATUS_ORDER = { miss: 0, hit50: 1, hit10: 2, hit5: 3 };
/** 未进池归因：桥未命中（事件 / 典故名未匹配）与并池后掉窗（桥命中但组内段全在 50 名外）分开计。 */
const statusOf = (rank) => (rank >= 1 && rank <= 5 ? 'hit5' : rank >= 6 && rank <= 10 ? 'hit10' : rank > 10 ? 'hit50' : 'miss');
const bucket = (n) => (n === 1 ? '单段' : n <= 10 ? '多段(2-10)' : '大组(>10)');
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** 汇总一组题：hit@k 为累计口径（组内首段进 top-k 即计）；cover@5 = top5 命中组内段数 / min(5, 组大小)。 */
function summarize(list) {
  const s = { total: 0, hit5: 0, hit10: 0, hit50: 0, miss: 0, noBridge: 0, missNoBridge: 0, dropped: 0, sumHits5: 0, sumCap5: 0 };
  for (const r of list) {
    s.total++;
    if (r.firstRank >= 1 && r.firstRank <= 5) s.hit5++;
    if (r.firstRank >= 1 && r.firstRank <= 10) s.hit10++;
    if (r.firstRank >= 1) s.hit50++;
    else s.miss++;
    if (!r.bridgeHit) s.noBridge++;
    if (r.firstRank === 0) {
      if (r.bridgeHit) s.dropped++;
      else s.missNoBridge++;
    }
    s.sumHits5 += r.hits5;
    s.sumCap5 += Math.min(5, r.segCount);
  }
  return { ...s, hit10Rate: s.total ? s.hit10 / s.total : 0, cover5: s.sumCap5 ? s.sumHits5 / s.sumCap5 : 0 };
}

function groupBy(list, keyFn) {
  const acc = {};
  for (const r of list) (acc[keyFn(r)] ??= []).push(r);
  return acc;
}

/** 找上一份快照（排除本次文件名）。 */
function prevSnapshot(curName) {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const names = fs.readdirSync(RESULTS_DIR).filter((n) => /^events-recall-.*\.json$/.test(n) && n !== curName).sort();
  return names.length ? path.join(RESULTS_DIR, names[names.length - 1]) : null;
}

/** 逐题比环比：档位降级 = 退化，升级 = 改善（同档位内 firstRank 变化不计）。 */
function compareWithPrev(prevPath, results) {
  const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
  const prevMap = new Map((prev.results ?? []).map((r) => [r.id, r]));
  const regressed = [];
  const improved = [];
  for (const r of results) {
    const p = prevMap.get(r.id);
    if (!p) continue;
    if (STATUS_ORDER[r.status] < STATUS_ORDER[p.status]) regressed.push({ id: r.id, question: r.question, from: `${p.status}@${p.firstRank}`, to: `${r.status}@${r.firstRank}` });
    else if (STATUS_ORDER[r.status] > STATUS_ORDER[p.status]) improved.push({ id: r.id, question: r.question, from: `${p.status}@${p.firstRank}`, to: `${r.status}@${r.firstRank}` });
  }
  return { prevFile: path.basename(prevPath), prevGeneratedAt: prev.meta?.generatedAt ?? '', regressed, improved };
}

const table = (rows, label) =>
  [
    `| ${label} | 题数 | hit@5 | hit@10 | hit@50 | 未进池 | 通过率(hit@10) | cover@5 |`,
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...Object.entries(rows).map(([k, v]) => `| ${k} | ${v.total} | ${v.hit5} | ${v.hit10} | ${v.hit50} | ${v.miss} | ${pct(v.hit10Rate)} | ${pct(v.cover5)} |`),
  ].join('\n');

const listLines = (list, head) => (list.length ? [`${head} ${list.length} 题`, ...list.slice(0, 20).map((r) => `- ${r.question}（${r.from} → ${r.to}）`)] : [`${head} 0 题`]);

async function main() {
  const { SangoIndex } = await import(pathToFileURL(path.resolve(SANGO_DIR, 'dist', 'search', 'sango-index.js')).href);
  const evalSet = JSON.parse(fs.readFileSync(EVAL_SET, 'utf8'));
  const rows = evalSet.rows.slice(0, LIMIT);
  const index = new SangoIndex(path.resolve(SANGO_DIR, 'data'));
  index.load();
  console.error(`[events-recall] eval=${EVAL_SET} 题数=${rows.length}/${evalSet.rows.length} 窗口=${INFER_LIMIT}`)

  const t0 = performance.now();
  const results = [];
  for (const r of rows) {
    const { entries, diagnostics } = await index.search(r.question, INFER_LIMIT, { diagnostics: true });
    const bridgeGroups = (diagnostics?.eventHit?.groupCount ?? 0) + (diagnostics?.allusionHit?.groupCount ?? 0);
    const rankOf = new Map();
    entries.forEach((e, i) => {
      if (!rankOf.has(e.id)) rankOf.set(e.id, i + 1);
    });
    const ranks = r.chunkIds.map((c) => rankOf.get(c) ?? 0).filter((x) => x > 0);
    const hits5 = ranks.filter((x) => x <= 5).length;
    const hits10 = ranks.filter((x) => x <= 10).length;
    const firstRank = ranks.length ? Math.min(...ranks) : 0;
    results.push({
      id: r.id,
      question: r.question,
      category: r.category,
      segCount: r.segCount,
      crossChapter: r.crossChapter,
      status: statusOf(firstRank),
      firstRank,
      hits5,
      hits10,
      hit5: firstRank >= 1 && firstRank <= 5,
      hit10: firstRank >= 1 && firstRank <= 10,
      hit50: firstRank >= 1,
      bridgeGroups,
      bridgeHit: bridgeGroups > 0,
      top10Ids: entries.slice(0, 10).map((e) => e.id),
    });
  }
  const elapsedMs = Math.round((performance.now() - t0) * 10) / 10;

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const name = `events-recall-${stamp()}`;
  const jsonPath = path.join(RESULTS_DIR, `${name}.json`);
  const mdPath = path.join(RESULTS_DIR, `${name}-summary.md`);
  const all = summarize(results);
  const byCategory = Object.fromEntries(Object.entries(groupBy(results, (r) => r.category)).map(([k, v]) => [k, summarize(v)]));
  const byBucket = Object.fromEntries(Object.entries(groupBy(results, (r) => bucket(r.segCount))).map(([k, v]) => [k, summarize(v)]));
  const prevPath = prevSnapshot(`${name}.json`);
  const compare = prevPath ? compareWithPrev(prevPath, results) : null;

  const snapshot = {
    meta: {
      generatedAt: new Date().toISOString(),
      evalSet: EVAL_SET,
      evalSetMeta: evalSet.meta ?? {},
      engine: { name: 'SangoIndex', inferLimit: INFER_LIMIT },
      elapsedMs,
      judged: 'chunkIds 组命中：hit@k = top-k 含组内任一段；bridgeHit = 事件 / 典故名桥命中（诊断 eventHit / allusionHit）',
    },
    summary: { ...all, byCategory, byBucket, compare },
    results,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 1)}\n`, 'utf8');

  const missList = results.filter((r) => r.status === 'miss');
  const md = [
    '# 事件 / 典故组召回探针快照',
    '',
    `> 判分单位 = 事件 / 典故 chunkIds 组：hit@k = top-k 含组内任一段；cover@5 = top5 命中组内段数 / min(5, 组大小)。零 LLM，引擎 SangoIndex（窗口 ${INFER_LIMIT}）。`,
    `> 评测集 ${EVAL_SET}（L1 + L2 + 典故，剔除 L3）；题数 ${results.length}；生成 ${snapshot.meta.generatedAt}；检索耗时 ${elapsedMs} ms。`,
    '',
    '## 总分档',
    '',
    table(byBucket, '分档'),
    '',
    `合计 ${all.total} 题：hit@5 ${all.hit5} / hit@10 ${all.hit10} / hit@50 ${all.hit50} / 未进池 ${all.miss}（桥未命中 ${all.missNoBridge}、并池后掉窗 ${all.dropped}），通过率 ${pct(all.hit10Rate)}，cover@5 ${pct(all.cover5)}。`,
    `桥命中 ${all.total - all.noBridge}/${all.total}（${pct((all.total - all.noBridge) / all.total)}）：桥未命中的题多由常规三路召回进窗，故桥命中率与召回率须分开读。`,
    '',
    '## 分类别',
    '',
    table(byCategory, '类别'),
    '',
    '## 环比上一份快照',
    '',
    ...(compare
      ? [`对照 ${compare.prevFile}（生成 ${compare.prevGeneratedAt}）：退化 ${compare.regressed.length} 题 / 改善 ${compare.improved.length} 题。`, '', ...listLines(compare.regressed, '退化'), '', ...listLines(compare.improved, '改善')]
      : ['（本目录暂无上一份快照，首次运行）']),
    '',
    '## 未进 50 路池',
    '',
    ...(missList.length ? missList.map((r) => `- [${r.category}] ${r.question}（组 ${r.segCount} 段）`) : ['（无）']),
    '',
  ].join('\n');
  fs.writeFileSync(mdPath, md, 'utf8');

  console.log(`事件 / 典故组召回：${all.total} 题，hit@10 ${all.hit10}（${pct(all.hit10Rate)}），hit@5 ${all.hit5}，hit@50 ${all.hit50}，未进池 ${all.miss}（桥未命中 ${all.missNoBridge} / 掉窗 ${all.dropped}），cover@5 ${pct(all.cover5)}`);
  console.log(`  桥命中 ${all.total - all.noBridge}/${all.total}（${pct((all.total - all.noBridge) / all.total)}）`);
  for (const [k, v] of Object.entries(byBucket)) console.log(`  ${k}: hit@10 ${v.hit10}/${v.total}（${pct(v.hit10Rate)}）`);
  if (compare) console.log(`环比 ${compare.prevFile}：退化 ${compare.regressed.length} / 改善 ${compare.improved.length}`);
  console.log(`落盘 ${jsonPath}（${fs.statSync(jsonPath).size} 字节）+ ${path.basename(mdPath)}`);
}

await main();
