#!/usr/bin/env node
/**
 * 三国演义语料 chunk 切分 · 决策证据（docs/sango-corpus-spec.md §3 算法的参考实现）
 *
 * 运行：node --experimental-strip-types docs/sango-chunk-sweep.mjs
 *
 * 口径与 sango-recall-bench.mjs 同源：同一语料、同一 24 例基准、同一 BM25 参数
 * （k1=1.5 / b=0.75）、同一别名归一化（语料侧与 query 侧同时做）。
 * 注入窗口直接 import orchestrator 的 trimFragmentToWindow，不复制逻辑。
 *
 * 指标口径：
 *   @k           答案段（含判定正则的段）折算后的排名命中率（同段多 chunk 取最好名次）
 *   750/1000覆盖 按排名累加 chunk 字数至预算上限，答案是否已进入注入（最贴近真实注入约束）
 *   top5重复     top5 内存在共享整句的 chunk 对（重叠量化的直接读数）
 *   引号断       含引号的 chunk 中 “/” 不配对的占比（引语被切断的度量）
 */
import { readFileSync } from 'node:fs';
import { SangoIndex } from 'file:///D:/workplace/mcp-server/sango/src/search/sango-index.ts';
import { tokenize } from 'file:///D:/workplace/mcp-server/sango/src/utils/text.ts';
import { trimFragmentToWindow } from 'file:///D:/workplace/mcp-orchestrator/src/citation.ts';

const SANGO_DIR = 'D:/workplace/mcp-server/sango';
const MAIN_CASE = '孙权遣人向关羽求亲，关羽是怎么回复使者的';
const OPEN = '\u201c';
const CLOSE = '\u201d';

// ===================== 切分算法（规范 §3 的参考实现） =====================
const splitSentences = (t) => t.split(/(?<=[。！？；])/).filter((s) => s.trim());
const quoteDelta = (s) =>
  (s.match(new RegExp(OPEN, 'g')) ?? []).length - (s.match(new RegExp(CLOSE, 'g')) ?? []).length;

/** 步骤 1：切句。步骤 2（可选）：引语未配平则向后并句，上限 quoteMax（0 = 不并句） */
function toUnits(text, quoteMax) {
  const out = [];
  for (const s of splitSentences(text)) {
    const prev = out[out.length - 1];
    if (quoteMax > 0 && prev && prev.open > 0 && prev.s.length + s.length <= quoteMax) {
      prev.s += s;
      prev.open = Math.max(0, prev.open + quoteDelta(s));
    } else {
      out.push({ s, open: Math.max(0, quoteDelta(s)) });
    }
  }
  return out;
}

/**
 * 步骤 3：顺序装箱到 target，不在 unit 内部切分（至少装 1 个 unit）。
 * closeQuoteCap > 0 时，箱尾引语未配平则继续吞入后续 unit 至配平或达上限；
 * 吞入的 unit 计入 end，下一箱从 end 继续，保证不重复、不遗漏（不变量 I1）。
 */
function packUnits(units, target, closeQuoteCap = 0) {
  const out = [];
  let start = 0;
  while (start < units.length) {
    let end = start;
    let len = 0;
    while (end < units.length && (len === 0 || len + units[end].s.length <= target)) {
      len += units[end].s.length;
      end++;
    }
    if (closeQuoteCap > 0) {
      let depth = units.slice(start, end).reduce((d, u) => d + quoteDelta(u.s), 0);
      while (depth > 0 && end < units.length && len + units[end].s.length <= closeQuoteCap) {
        depth += quoteDelta(units[end].s);
        len += units[end].s.length;
        end++;
      }
    }
    out.push(units.slice(start, end));
    if (end >= units.length) break;
    start = end;
  }
  return out;
}

/** 步骤 4+5：按回组装（跨段）+ 尾部碎片软下限 + 可选重叠 */
function buildChunks(docs, { target, quoteMax = 0, crossSeg = true, minTarget = 0, overlapSent = 0, closeQuoteCap = 0 }) {
  const chunks = [];
  const emit = (items, type) => {
    if (!items.length) return;
    const segs = [...new Set(items.map((x) => x.seg))];
    chunks.push({
      text: items.map((x) => x.s).join(''),
      segs, type,
      chapter: docs[segs[0]].chapter,
      title: docs[segs[0]].title,
      firstSeg: docs[segs[0]].segIndex,
      lastSeg: docs[segs[segs.length - 1]].segIndex,
    });
  };
  for (const ch of [...new Set(docs.map((d) => d.chapter))]) {
    const idxs = docs.map((d, i) => (d.chapter === ch ? i : -1)).filter((i) => i >= 0);
    const groups = [];
    for (const i of idxs) {
      const items = toUnits(docs[i].text, quoteMax).map((u) => ({ ...u, seg: i }));
      const last = groups[groups.length - 1];
      const joinable = crossSeg && docs[i].type === 'narration' && last && last.type === 'narration';
      if (joinable) last.items.push(...items);
      else groups.push({ type: docs[i].type, items });
    }
    for (const g of groups) for (const part of packUnits(g.items, target, closeQuoteCap)) emit(part, g.type);
  }
  if (minTarget > 0) {
    const merged = [];
    for (const c of chunks) {
      const prev = merged[merged.length - 1];
      if (prev && prev.chapter === c.chapter && prev.type === c.type
          && c.text.length < minTarget && prev.text.length + c.text.length <= target * 1.6) {
        prev.text += c.text;
        prev.segs = [...new Set([...prev.segs, ...c.segs])];
        prev.lastSeg = c.lastSeg;
      } else merged.push({ ...c });
    }
    chunks.length = 0;
    chunks.push(...merged);
  }
  if (overlapSent > 0) {
    for (let i = 1; i < chunks.length; i++) {
      if (chunks[i].chapter !== chunks[i - 1].chapter) continue;
      chunks[i] = {
        ...chunks[i],
        text: splitSentences(chunks[i - 1].text).slice(-overlapSent).join('') + chunks[i].text,
      };
    }
  }
  return chunks;
}

// ===================== 语料 + 别名归一化 =====================
const idx = new SangoIndex();
idx.load();
const docs = idx.docs.map((d) => ({
  chapter: d.chapter, title: d.title, segIndex: d.segIndex, type: d.segType, text: d.text,
}));
const origTexts = docs.map((d) => d.text);

const aliasRaw = JSON.parse(readFileSync(`${SANGO_DIR}/data/alias.json`, 'utf8'));
const pidOf = new Map(Object.entries(aliasRaw));
const byPid = new Map();
for (const [name, pid] of Object.entries(aliasRaw)) {
  if (!byPid.has(pid)) byPid.set(pid, []);
  byPid.get(pid).push(name);
}
const canonOf = new Map();
for (const [pid, names] of byPid) {
  canonOf.set(pid, names.slice().sort((a, b) => (idx.df.get(b) ?? 0) - (idx.df.get(a) ?? 0))[0]);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIAS_PATTERN = new RegExp(
  [...pidOf.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'g');
const norm = (t) => t.replace(ALIAS_PATTERN, (m) => canonOf.get(pidOf.get(m)));

// ===================== 用例集（与 sango-recall-bench.mjs 同一 24 例） =====================
const RAW = [
  ['孙权遣人向关羽求亲，关羽是怎么回复使者的', /虎女安肯嫁犬子/],
  ['关羽求亲', /虎女安肯嫁犬子/],
  ['关羽怎么拒绝孙权的联姻', /虎女安肯嫁犬子/],
  ['关羽为何辱骂孙权', /虎女安肯嫁犬子/],
  ['诸葛瑾去荆州做什么', /虎女安肯嫁犬子/],
  ['曹操献刀', /献刀/],
  ['关羽水淹七军', /水淹七军/],
  ['曹操割发代首', /割发/],
  ['张辽威震逍遥津', /逍遥津/],
  ['吕布辕门射戟', /射戟/],
  ['许褚裸衣斗马超', /裸衣/],
  ['关羽刮骨疗毒', /刮骨/],
  ['关羽单刀赴会', /单刀赴会/],
  ['诸葛亮骂死王朗', /骂死/],
  ['赵云截江救阿斗', /截江/],
  ['诸葛亮空城计', /空城/],
  ['关羽斩颜良', /斩颜良/],
  ['张飞喝断当阳桥', /当阳桥/],
  ['刘备托孤', /托孤/],
  ['七擒孟获', /孟获/],
  ['火烧赤壁', /赤壁/],
  ['三顾茅庐', /三顾/],
  ['桃园结义', /桃园结义/],
  ['曹操煮酒论英雄', /煮酒/],
  ['诸葛亮隆中对', /隆中/],
];
const CASES = RAW.filter(([, re]) => origTexts.some((t) => re.test(t)));
const N = CASES.length;
const MAIN = CASES.findIndex(([q]) => q === MAIN_CASE);
const pct = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))];
};
const sum = (a) => a.reduce((x, y) => x + y, 0);

// ===================== BM25（与 sango-index.ts 同参数） =====================
function buildIndex(texts) {
  const toks = texts.map(tokenize);
  const postings = new Map();
  const df = new Map();
  toks.forEach((tt, i) => {
    const tf = new Map();
    for (const t of tt) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, f] of tf) {
      df.set(t, (df.get(t) ?? 0) + 1);
      const arr = postings.get(t) ?? [];
      arr.push({ d: i, tf: f });
      postings.set(t, arr);
    }
  });
  return { toks, postings, df, avg: sum(toks.map((t) => t.length)) / texts.length, n: texts.length };
}
function rankOf(bi, query) {
  const score = new Float64Array(bi.n);
  for (const t of tokenize(norm(query))) {
    const posts = bi.postings.get(t);
    if (!posts) continue;
    const df = bi.df.get(t) ?? 0;
    const idf = Math.log(1 + (bi.n - df + 0.5) / (df + 0.5));
    for (const p of posts) {
      const dl = bi.toks[p.d].length;
      score[p.d] += idf * ((p.tf * 2.5) / (p.tf + 1.5 * (0.25 + 0.75 * (dl / bi.avg))));
    }
  }
  return Array.from({ length: bi.n }, (_, i) => i)
    .filter((i) => score[i] > 0)
    .sort((a, b) => score[b] - score[a]);
}

// ===================== 指标 =====================
function measure(label, units) {
  const bi = buildIndex(units.map((u) => norm(u.text)));
  const orders = CASES.map(([q]) => rankOf(bi, q));
  const ranks = CASES.map(([q, re], ci) => {
    const r = orders[ci].findIndex((i) => re.test(units[i].text));
    return r < 0 ? -1 : r + 1;
  });
  let quoted = 0;
  let unpaired = 0;
  for (const u of units) {
    const o = (u.text.match(new RegExp(OPEN, 'g')) ?? []).length;
    const c = (u.text.match(new RegExp(CLOSE, 'g')) ?? []).length;
    if (o + c > 0) quoted++;
    if (o !== c) unpaired++;
  }
  const cov = (budget) => CASES.filter(([, re], ci) => {
    let used = 0;
    for (const i of orders[ci]) {
      if (used + units[i].text.length > budget) break;
      used += units[i].text.length;
      if (re.test(units[i].text)) return true;
    }
    return false;
  }).length;
  let dup = 0;
  for (let ci = 0; ci < N; ci++) {
    const top = orders[ci].slice(0, 5).map((i) => new Set(splitSentences(units[i].text)));
    let f = false;
    for (let a = 0; a < top.length && !f; a++) {
      for (let b = a + 1; b < top.length; b++) {
        for (const s of top[a]) if (top[b].has(s)) { f = true; break; }
      }
    }
    if (f) dup++;
  }
  let cut = 0;
  let cutTotal = 0;
  for (const [q, re] of CASES) {
    const o = rankOf(bi, q);
    if (!o.length) continue;
    cutTotal++;
    if (!re.test(trimFragmentToWindow({ text: units[o[0]].text, source: 'sanguo-yanyi' }, q).text)) cut++;
  }
  const lens = units.map((u) => u.text.length);
  return {
    label, units, n: units.length, avg: Math.round(sum(lens) / lens.length),
    min: Math.min(...lens), p50: pct(lens, 0.5), p90: pct(lens, 0.9), max: Math.max(...lens),
    tiny: lens.filter((l) => l < 80).length,
    hit1: ranks.filter((r) => r > 0 && r <= 1).length,
    hit3: ranks.filter((r) => r > 0 && r <= 3).length,
    hit5: ranks.filter((r) => r > 0 && r <= 5).length,
    unpaired, quoted, cut, cutTotal, cov750: cov(750), cov1000: cov(1000), dup,
    main: MAIN >= 0 ? ranks[MAIN] : -1,
    broken: CASES.filter(([, re]) => !units.some((u) => re.test(u.text))).length,
    crossSeg: units.filter((u) => u.segs && u.segs.length > 1).length,
  };
}
const HEAD = '配置'.padEnd(28) + 'chunk'.padEnd(7) + '均长'.padEnd(6) + '最短'.padEnd(6) + 'p90'.padEnd(6) + 'max'.padEnd(7)
  + '引号断'.padEnd(9) + '@1'.padEnd(7) + '@3'.padEnd(7) + '@5'.padEnd(7)
  + '750覆盖'.padEnd(9) + '1000覆盖'.padEnd(10) + 'top5重复'.padEnd(10) + '主案例';
const row = (m) =>
  m.label.padEnd(28) + String(m.n).padEnd(7) + String(m.avg).padEnd(6) + String(m.min).padEnd(6) + String(m.p90).padEnd(6) + String(m.max).padEnd(7)
  + `${Math.round((m.unpaired / m.quoted) * 100)}%`.padEnd(9) + `${m.hit1}/${N}`.padEnd(7) + `${m.hit3}/${N}`.padEnd(7) + `${m.hit5}/${N}`.padEnd(7)
  + `${m.cov750}/${N}`.padEnd(9) + `${m.cov1000}/${N}`.padEnd(10) + `${m.dup}/${N}`.padEnd(10)
  + `#${m.main < 0 ? 'miss' : m.main}`;

// ===================== §1 现状长度分布 =====================
const segLens = origTexts.map((t) => t.length);
const sentLens = origTexts.flatMap(splitSentences).map((s) => s.length);
console.log('=== 1 现状长度分布（单位：汉字数）===');
console.log(`段 ${segLens.length} 个 / 合计 ${sum(segLens)} 字 / 平均 ${Math.round(sum(segLens) / segLens.length)} 字`);
console.log(`段长 p10=${pct(segLens, 0.1)} p50=${pct(segLens, 0.5)} p90=${pct(segLens, 0.9)} p99=${pct(segLens, 0.99)} max=${Math.max(...segLens)}`);
console.log(`句 ${sentLens.length} 个 / 平均 ${Math.round(sum(sentLens) / sentLens.length)} 字 / p50=${pct(sentLens, 0.5)} p90=${pct(sentLens, 0.9)} p99=${pct(sentLens, 0.99)} max=${Math.max(...sentLens)}`);
for (const t of ['narration', 'verse', 'comment']) {
  const ls = docs.filter((d) => d.type === t).map((d) => d.text.length);
  if (ls.length) console.log(`  ${t}: ${ls.length} 段 / 平均 ${Math.round(sum(ls) / ls.length)} 字 / max ${Math.max(...ls)}`);
}
console.log(`  段长 > 250 字：${segLens.filter((l) => l > 250).length}（${Math.round((segLens.filter((l) => l > 250).length / segLens.length) * 100)}%）`);

const baseline = measure('现状：整段（段级）', docs.map((d, i) => ({
  text: d.text, segs: [i], chapter: d.chapter, title: d.title, firstSeg: d.segIndex, lastSeg: d.segIndex,
})));

console.log('\n=== 2 尺寸扫描（句边界 / 跨段 / 软下限 100 / 无重叠）===');
console.log(HEAD);
console.log(row(baseline));
for (const target of [150, 200, 250, 300, 400]) {
  console.log(row(measure(`目标 ${target} 字`, buildChunks(docs, { target, minTarget: 100 }))));
}

console.log('\n=== 3 重叠量扫描（目标 250 / 句边界 / 跨段 / 软下限 100）===');
console.log(HEAD);
for (const ov of [0, 1, 2]) {
  console.log(row(measure(ov === 0 ? '无重叠（推荐）' : `重叠 ${ov} 句（≈${ov * 18} 字）`, buildChunks(docs, { target: 250, minTarget: 100, overlapSent: ov }))));
}

console.log('\n=== 4 跨段开关（目标 250 / 句边界 / 软下限 100 / 无重叠）===');
console.log(HEAD);
console.log(row(measure('不跨段（段内切分）', buildChunks(docs, { target: 250, crossSeg: false, minTarget: 100 }))));
console.log(row(measure('章内跨段（推荐）', buildChunks(docs, { target: 250, crossSeg: true, minTarget: 100 }))));

console.log('\n=== 5 尾部碎片软下限（目标 250 / 句边界 / 跨段 / 无重叠）===');
console.log(HEAD + '  tiny');
for (const minTarget of [0, 100, 150, 200]) {
  const m = measure(minTarget === 0 ? '软下限 0（不并块）' : `软下限 ${minTarget} 字`, buildChunks(docs, { target: 250, minTarget }));
  console.log(row(m).padEnd(136) + String(m.tiny));
}

console.log('\n=== 6 引语配平上限（目标 250 / 跨段 / 软下限 100 / 无重叠）===');
console.log(HEAD);
for (const quoteMax of [0, 200, 300, 500, Infinity]) {
  const label = quoteMax === 0 ? '上限 0（不并句）' : quoteMax === Infinity ? '上限 不限（完全原子）' : `上限 ${quoteMax} 字`;
  console.log(row(measure(label, buildChunks(docs, { target: 250, quoteMax, minTarget: 100 }))));
}

console.log('\n=== 6b 箱尾引语配平延伸（目标 250 / 跨段 / 软下限 100 / 无重叠）===');
console.log(HEAD);
console.log(row(measure('不延伸', buildChunks(docs, { target: 250, minTarget: 100 }))));
for (const cap of [300, 400, 500]) {
  console.log(row(measure(`延伸至 ${cap} 字`, buildChunks(docs, { target: 250, minTarget: 100, closeQuoteCap: cap }))));
}

// ===================== §7 推荐配置 =====================
const RECOMMEND = { target: 250, quoteMax: 0, crossSeg: true, minTarget: 100, overlapSent: 0, closeQuoteCap: 400 };
const rec = measure('推荐', buildChunks(docs, RECOMMEND));
console.log('\n=== 7 推荐配置 vs 现状 ===');
console.log('指标'.padEnd(30) + '现状（段级）'.padEnd(18) + '推荐（chunk 250）');
for (const [k, a, b] of [
  ['检索单元数', baseline.n, rec.n],
  ['单元长度 均/最短/p90/max', `${baseline.avg}/${baseline.min}/${baseline.p90}/${baseline.max}`, `${rec.avg}/${rec.min}/${rec.p90}/${rec.max}`],
  ['召回 @1', `${baseline.hit1}/${N}`, `${rec.hit1}/${N}`],
  ['召回 @3', `${baseline.hit3}/${N}`, `${rec.hit3}/${N}`],
  ['召回 @5', `${baseline.hit5}/${N}`, `${rec.hit5}/${N}`],
  ['750 字注入预算覆盖', `${baseline.cov750}/${N}`, `${rec.cov750}/${N}`],
  ['1000 字注入预算覆盖', `${baseline.cov1000}/${N}`, `${rec.cov1000}/${N}`],
  ['引号不配对占比', `${Math.round((baseline.unpaired / baseline.quoted) * 100)}%`, `${Math.round((rec.unpaired / rec.quoted) * 100)}%`],
  ['答案句被切碎（天花板）', `${baseline.broken}/${N}`, `${rec.broken}/${N}`],
  ['top1 过窗口截断后含答案句', `${baseline.cutTotal - baseline.cut}/${baseline.cutTotal}`, `${rec.cutTotal - rec.cut}/${rec.cutTotal}`],
  ['top5 近重复', `${baseline.dup}/${N}`, `${rec.dup}/${N}`],
  ['跨段 chunk', '0', `${rec.crossSeg}（${Math.round((rec.crossSeg / rec.n) * 100)}%）`],
  ['主案例（第73回 段5）排名', `#${baseline.main}`, `#${rec.main}`],
]) console.log(String(k).padEnd(30) + String(a).padEnd(18) + String(b));

// ===================== §8 不变量校验 =====================
console.log('\n=== 8 不变量校验 ===');
const chunks = buildChunks(docs, RECOMMEND);
let mismatch = 0;
for (const ch of [...new Set(docs.map((d) => d.chapter))]) {
  const joined = chunks.filter((c) => c.chapter === ch).map((c) => c.text).join('');
  const origin = docs.filter((d) => d.chapter === ch).map((d) => d.text).join('');
  if (joined !== origin) mismatch++;
}
const inSentence = chunks.filter((c) => !/[。！？；\u201d]$/.test(c.text)).length;
console.log(`  I1 同回 chunk 拼接 === 原文段拼接：${mismatch === 0 ? 'PASS' : `FAIL（${mismatch} 回）`}`);
console.log(`  I2 chunk 跨回（应为 0）：${chunks.filter((c) => new Set(c.segs.map((s) => docs[s].chapter)).size > 1).length}`);
console.log(`  I3 chunk 末尾不是句末标点：${inSentence}（引语配平延伸所致的唯一预期越界来源）`);
console.log(`  I4 答案句被切碎（应为 0）：${rec.broken}`);
console.log(`  I5 长度 < 80 字的 chunk：${rec.tiny}`);
console.log(`  I6 chunk 超目标 250 字：${chunks.filter((c) => c.text.length > 250).length} / ${chunks.length}`);
console.log(`  I7 chunk 超配平上限 400 字（应为 0）：${chunks.filter((c) => c.text.length > 400).length}`);