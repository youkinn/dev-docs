/**
 * feat-A016 术语口径差异统计脚本（零 LLM）
 *
 * 目标：对 A015 标准集 + 链路日志在线 query，结合现有别名表（alias.json）、
 * 白名单素材底稿（docs/sango-entity-normalization.md）与演义语料，产出三份产物：
 *   1. report/feat-A016-entity-diff-report.md   —— 差异清单 + 歧义词归属 + 歧义语境核查（验收 1 / 7 落档）
 *   2. report/feat-A016-entity-diff-data.json   —— 结构化统计（供复查 / 复跑对比）
 *   3. report/feat-A016-entity-table-draft.json —— 别名 / 换说法表起草（供老陈表设计合并）
 *
 * 核查分层（防漏制度化）：
 *   ① 机械查重：同串跨行（同词出现在 >=2 个 group）与同规范形冲突
 *   ② 领域初审：素材底稿「疑似跨主条目词」+ 官职/爵位类 + 人物节称号型别名 → 候选集
 *   ③ 语料归属统计终审：候选词在语料上下文中的指称分布（邻近人名 → PID），
 *      跨主条目者禁入改写键（原文直配 + 标签多挂），单指称者才可收录
 *   ④ 歧义语境核查：单字（口/目/眼…）与部分-整体词（唇/舌/齿/牙 vs 嘴）——
 *      枚举语料歧义复合词份额，超阈值禁入（改写键 + 片段侧单字替换均禁），只留安全短语键
 *
 * 用法：
 *   node test/term-diff/term-diff.mjs
 *   （路径可用环境变量覆盖：STD_SET / LOGS_DB / ALIAS_JSON / MATERIAL_MD / CORPUS_DIR / OUT_DIR）
 *
 * 依赖：Node >= 22.5（node:sqlite，只读打开日志库）。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CFG = {
  stdSet: process.env.STD_SET || path.join(ROOT, 'docs', 'sango-rag-regression-benchmark_v0.1.md'),
  logsDb: process.env.LOGS_DB || 'D:\\workplace\\mcp-orchestrator\\data\\logs.db',
  aliasJson: process.env.ALIAS_JSON || 'D:\\workplace\\mcp-server\\sango\\data\\alias.json',
  materialMd: process.env.MATERIAL_MD || path.join(ROOT, 'docs', 'sango-entity-normalization.md'),
  corpusDir: process.env.CORPUS_DIR || 'D:\\workplace\\mcp-server\\sango\\data\\corpus\\sanguo-yanyi',
  outDir: process.env.OUT_DIR || path.join(ROOT, 'test', 'term-diff', 'report'),
};

// ---------- 1. 解析类 ----------

/** A015 标准集：11 类小节 + | # | 问题 | 标准答案 | 证据 | 表格行（与 mcp-server benchmark parser 同口径）。 */
const STD_CATEGORIES = ['人物', '地名', '战役', '典故', '器物', '身体部位', '官职', '数字称谓', '事件关系', '死亡', '拒答'];
export function parseStdSet(md) {
  const qs = [];
  let category = '';
  for (const line of md.split(/\r?\n/)) {
    const sec = line.match(/^##\s+(.+)$/);
    if (sec) {
      const raw = sec[1].replace(/^[一二三四五六七八九十]+、?\s*/, '').trim();
      category = STD_CATEGORIES.find((c) => raw.startsWith(c)) ?? '';
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (!/^\d+$/.test(cells[1])) continue;
    if (!category || !cells[2] || !cells[4]) continue;
    qs.push({ id: category + '#' + cells[1], category, question: cells[2] });
  }
  return qs;
}

/** 日志库 tool_retrieval_logs.diagnostics.query.raw → 去重 query 集。 */
export function loadOnlineQueries(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare('SELECT diagnostics FROM tool_retrieval_logs').all();
    const set = new Set();
    for (const r of rows) {
      try {
        const d = JSON.parse(r.diagnostics);
        if (d && d.query && d.query.raw) set.add(String(d.query.raw));
      } catch {
        /* 单行脏数据跳过 */
      }
    }
    return [...set];
  } finally {
    db.close();
  }
}

/** alias.json（人名别名 → PID）。 */
export function loadAlias(json) {
  return JSON.parse(json);
}

/** 素材底稿：章节 → rows（规范形 | 别名1、别名2…）；「疑似跨主条目词」节 → bullets。 */
const NUM_CHARS = /[0-9一二三四五六七八九十百千万两]/;
const TYPE_LABEL = {
  '地名/地点类': '地名', '战役/事件类': '战役', '势力/阵营类': '势力', '官职/爵位类': '官职',
  '物品/器械类': '器物', '时间/年号类': '时间', '计谋/典故类': '典故', '身体器官类': '身体',
  '死亡类': '死亡', '登场类': '登场', '数字称谓（含数字的典故固定称谓）': '数字称谓', '人物': '人物',
};
const typeLabel = (t) => TYPE_LABEL[t] ?? t;

/** ④歧义语境核查白名单（零 LLM）：单字 / 部分-整体词 → 歧义复合词 / 安全短语。 */
const AMBIGUOUS_CONTEXTS = {
  '口': { semantic: '嘴', bad: ['关口', '山口', '渡口', '路口', '洞口', '出口', '入口', '港口', '井口', '刀口', '窗口', '城口', '人口', '一口'], good: ['口中', '口吐', '口内', '口称', '开口', '闭口', '口供', '口出'] },
  '目': { semantic: '眼睛', bad: ['目今', '目下', '目录', '条目', '回目', '名目', '数目', '科目'], good: ['左目', '右目', '双目', '眼目', '耳目', '怒目', '举目', '拭目', '侧目', '注目'] },
  '首': { semantic: '头', bad: ['首先', '回首', '自首', '首创'], good: ['首级', '斩首', '枭首'] },
  '发': { semantic: '头发', bad: ['发兵', '发明', '发怒', '发丧', '散发', '发付'], good: ['头发'] },
  '足': { semantic: '脚', bad: ['不足', '足以', '足下', '足矣', '足见', '丰足'], good: ['手足', '鼎足'] },
  '须': { semantic: '胡须', bad: ['必须', '须臾', '须得', '务须'], good: ['须发', '长须'] },
  '指': { semantic: '手指', bad: ['指示', '指挥', '指日', '指教', '指称'], good: ['手指', '十指'] },
  '面': { semantic: '脸', bad: ['面前', '方面'], good: ['面门', '面目', '面如'] },
  '肤': { semantic: '皮肤', bad: [], good: ['肌肤'] },
  '颜': { semantic: '容貌/面色', bad: [], good: ['汗颜', '龙颜'] },
  '唇': { semantic: '嘴唇（部分词，不与嘴互换）', bad: ['唇亡', '唇齿'], good: [] },
  '舌': { semantic: '舌头（部分词）', bad: ['舌战', '鼓舌', '摇舌'], good: ['舌头'] },
  '齿': { semantic: '牙齿（部分词）', bad: ['切齿', '唇齿', '齿冷'], good: ['牙齿', '皓齿'] },
  '牙': { semantic: '牙齿（部分词）', bad: [], good: ['咬牙', '门牙', '獠牙', '牙齿'] },
  '卒': { semantic: '死亡（单字，士卒误伤）', bad: ['士卒', '小卒', '狱卒', '兵卒', '走卒'], good: ['卒于'] },
  '亡': { semantic: '死亡（单字，逃亡/灭亡混）', bad: ['灭亡', '逃亡', '败亡', '存亡', '亡命'], good: ['身亡', '死亡', '阵亡'] },
  '崩': { semantic: '驾崩（单字，山崩/崩裂混）', bad: ['山崩', '崩裂'], good: ['驾崩'] },
  '死': { semantic: '死亡（单字，死战/死守为拼死义）', bad: ['死战', '死守'], good: ['身死', '死节'] },
  '薨': { semantic: '死亡（单字低歧义）', bad: [], good: ['薨逝'] },
  '殂': { semantic: '死亡（单字低歧义）', bad: [], good: ['崩殂'] },
  '殒': { semantic: '死亡（单字低歧义）', bad: [], good: ['殒命', '殒身'] },
  '殁': { semantic: '死亡（单字低歧义）', bad: [], good: [] },
  '许': { semantic: '许都（单字，许褚/许多/许诺混）', bad: ['许褚', '许多', '许诺'], good: ['许都', '许昌'] },
  '上': { semantic: '皇帝（单字，方位/动作义压倒）', bad: ['上马', '上前', '上面'], good: ['皇上'] },
  '相': { semantic: '丞相（单字，互相/相府/相思混）', bad: ['互相', '相府', '相思'], good: ['相国'] },
  '魏': { semantic: '曹魏（单字，魏延/魏兵混）', bad: ['魏延', '魏兵', '魏军'], good: ['魏国'] },
  '吴': { semantic: '东吴（单字，吴懿/吴班/吴郡混）', bad: ['吴懿', '吴班', '吴国太', '吴郡', '吴兵'], good: ['吴国', '孙吴'] },
  '蜀': { semantic: '蜀汉（单字，蜀郡/蜀兵混）', bad: ['蜀郡', '蜀兵'], good: ['蜀汉', '西蜀'] },
  '晋': { semantic: '西晋（单字，晋王/晋国混）', bad: ['晋王'], good: ['晋国', '大晋'] },
};

export function parseMaterial(md) {
  const groups = [];
  const suspects = [];
  let section = '';
  for (const line of md.split(/\r?\n/)) {
    const sec = line.match(/^##\s*(.+)$/);
    if (sec) {
      const name = sec[1].trim();
      section = name.startsWith('疑似跨主条目') ? '__suspect__' : name.replace(/^[一二三四五六七八九十]+、?\s*/, '').trim();
      continue;
    }
    if (section === '__suspect__') {
      const m = line.match(/^[-*]\s*(?:[（(].*?[）)]\s*)?(.+)$/);
      if (m) suspects.push({ raw: line, group: m[1] });
      continue;
    }
    if (!section || !line.includes('|') || /^(说明|>|#)/.test(line.trim())) continue;
    const parts = line.split('|').map((s) => s.trim());
    const canonical = parts[0];
    if (!canonical) continue;
    const aliases = (parts.slice(1).join('、') || '')
      .split(/[、,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    groups.push({
      type: section,
      canonical,
      aliases,
      numLike: NUM_CHARS.test(canonical) || aliases.some((a) => NUM_CHARS.test(a)),
    });
  }
  return { groups, suspects };
}

/** 语料：章回 + 全文（回目 + 正文分块）。 */
export function loadCorpus(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  const titles = [];
  let all = '';
  let chunkCount = 0;
  for (const f of files) {
    const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    titles.push({ chapter: d.chapter, title: d.title });
    all += d.title + '\n';
    for (const c of d.chunks ?? []) {
      all += c.text + '\n';
      chunkCount++;
    }
  }
  return { titles, all, chunkCount };
}

// ---------- 2. 分析 ----------

/** ①同串跨行机械查重：return Map<term, groupIds[]>。 */
function findTermConflicts(groups) {
  const holder = new Map();
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    for (const term of [g.canonical, ...g.aliases]) {
      const key = g.type + '::' + g.canonical;
      const arr = holder.get(term) ?? [];
      if (!arr.includes(key)) arr.push(key);
      holder.set(term, arr);
    }
  }
  return new Map([...holder].filter(([, v]) => v.length > 1));
}

/** query 侧扫描：每个 group 成员在标准集题面 / 在线 query 中的命中与示例。 */
function scanQueries(groups, stdQuestions, onlineQueries) {
  const hits = [];
  for (const g of groups) {
    const members = [g.canonical, ...g.aliases].filter((m) => m.length > 0);
    const std = stdQuestions.filter((q) => members.some((m) => q.question.includes(m)));
    const online = onlineQueries.filter((q) => members.some((m) => q.includes(m)));
    if (std.length || online.length) {
      hits.push({
        type: g.type,
        canonical: g.canonical,
        aliases: g.aliases,
        stdHits: std.map((q) => q.question),
        onlineHits: online.slice(0, 6),
        onlineTotal: online.length,
        numLike: g.numLike,
      });
    }
  }
  return hits;
}

/** ④歧义语境核查：单字 / 部分-整体词在语料中的歧义复合词份额。 */
function ambiguousContextCheck(corpus) {
  const count = (s) => corpus.all.split(s).length - 1;
  const out = [];
  for (const [term, cfg] of Object.entries(AMBIGUOUS_CONTEXTS)) {
    const bad = cfg.bad.map((k) => [k, count(k)]).filter(([, n]) => n > 0);
    const good = cfg.good.map((k) => [k, count(k)]).filter(([, n]) => n > 0);
    out.push({ term, semantic: cfg.semantic, total: count(term), bad, good, hasAmbiguity: bad.length > 0 });
  }
  return out;
}

/** 语料侧扫描：成员在回目 / 正文的出现次数。 */
function scanCorpus(groups, corpus) {
  const out = [];
  for (const g of groups) {
    const rows = [];
    for (const term of [g.canonical, ...g.aliases]) {
      if (!term) continue;
      let titleHits = 0;
      for (const t of corpus.titles) {
        if (t.title.includes(term)) titleHits++;
      }
      const bodyHits = corpus.all.split(term).length - 1 - titleHits;
      rows.push({ term, titleHits, bodyHits, total: titleHits + bodyHits });
    }
    if (rows.some((r) => r.total > 0)) out.push({ type: g.type, canonical: g.canonical, members: rows });
  }
  return out;
}

/** ③指称归属统计（终审）：候选词每次语料出现 → 上下文窗口 ±80 字 → 邻近人名别名 → PID 集合。 */
function referentDistribution(term, corpus, pidOfAlias, opts = {}) {
  const aliases = Object.keys(pidOfAlias).sort((a, b) => b.length - a.length); // 最长匹配优先
  const idx = [];
  let from = 0;
  while (true) {
    const i = corpus.all.indexOf(term, from);
    if (i < 0) break;
    idx.push(i);
    from = i + term.length;
  }
  const pidCount = new Map();
  let windowCount = 0;
  for (const i of idx) {
    const win = corpus.all
      .slice(Math.max(0, i - 80), Math.min(corpus.all.length, i + term.length + 80))
      .replace(/\s+/g, '');
    const pids = new Set();
    let pos = 0;
    while (pos < win.length) {
      const hit = aliases.find((a) => win.startsWith(a, pos));
      if (hit) {
        pids.add(pidOfAlias[hit]);
        pos += hit.length;
      } else {
        pos++;
      }
    }
    pids.delete(undefined);
    if (pids.size) {
      windowCount++;
      for (const p of pids) pidCount.set(p, (pidCount.get(p) ?? 0) + 1);
    }
  }
  const dist = [...pidCount.entries()].sort((a, b) => b[1] - a[1]);
  const top = dist[0];
  const second = dist[1];
  const share = windowCount ? (top?.[1] ?? 0) / windowCount : 0;
  const secondShare = windowCount && second ? second[1] / windowCount : 0;
  let verdict;
  if (opts.crossPerson) verdict = '跨主条目（同串跨人组）';
  else if (idx.length === 0) verdict = '语料未出现';
  else if (windowCount === 0) verdict = '泛称/官职裸词(无邻近人名)';
  else if (opts.prior === 'banned') verdict = '禁入改写键（泛官职裸词）';
  else if (share < 0.8) verdict = '跨主条目';
  else if (opts.prior === 'single') verdict = '唯一指称候选';
  else if (second && second[1] >= 2 && secondShare >= 0.2) verdict = '跨主条目（多主条目候选）';
  else verdict = '唯一指称候选';
  return { occurrences: idx.length, windowCount, dist, topPid: top?.[0] ?? null, share, verdict };
}

/** 登场类跨语义行拆细（登场 / 出场-亮相 / 出仕-入仕）。 */
function splitDebutAliases(aliases) {
  const appear = aliases.filter((a) => /首次|初次|登场|出场|现身|出现|始现|始出|初出/.test(a));
  const office = aliases.filter((a) => /出仕|出山|入仕/.test(a));
  const rest = aliases.filter((a) => !appear.includes(a) && !office.includes(a));
  return { appear, office, rest };
}

// ---------- 3. 主流程 ----------

function main() {
  const stdQuestions = parseStdSet(readFileSync(CFG.stdSet, 'utf8'));
  const onlineQueries = loadOnlineQueries(CFG.logsDb);
  const aliasMap = loadAlias(readFileSync(CFG.aliasJson, 'utf8'));
  const { groups, suspects } = parseMaterial(readFileSync(CFG.materialMd, 'utf8'));
  const corpus = loadCorpus(CFG.corpusDir);

  // 人物节 PID 继承：别名表 {别名→PID} + 人物节（规范形/别名 → 同组 PID）
  const pidOfAlias = { ...aliasMap };
  for (const g of groups) {
    if (g.type !== '人物') continue;
    const pid = pidOfAlias[g.canonical] ?? g.aliases.map((a) => pidOfAlias[a]).find(Boolean);
    if (pid) {
      pidOfAlias[g.canonical] = pid;
      for (const a of g.aliases) pidOfAlias[a] ??= pid;
    }
  }

  const conflicts = findTermConflicts(groups);
  const queryHits = scanQueries(groups, stdQuestions, onlineQueries);
  const corpusHits = scanCorpus(groups, corpus);
  const ambiguous = ambiguousContextCheck(corpus);

  // 必现案例对照（验收锚点）：需求指定两例的实测数据
  const anchorCase = (canonical, type) => {
    const g = groups.find((x) => x.canonical === canonical && x.type === type);
    if (!g) return null;
    const members = [g.canonical, ...g.aliases].filter((m) => m.length > 0);
    const std = stdQuestions.filter((q) => members.some((m) => q.question.includes(m))).map((q) => q.question);
    const online = onlineQueries.filter((q) => members.some((m) => q.includes(m)));
    const corpusStats = members.map((m) => {
      let titleHits = 0;
      for (const t of corpus.titles) if (t.title.includes(m)) titleHits++;
      const bodyHits = corpus.all.split(m).length - 1 - titleHits;
      return { term: m, titleHits, bodyHits };
    });
    return { g, std, online, corpusStats };
  };
  const anchors = [anchorCase('过五关斩六将', '战役/事件类'), anchorCase('眼睛', '身体器官类')].filter(Boolean);

  // ②跨主条目词候选集：素材底稿疑似节 + 官职/爵位类 + 人物节称号型别名 + 需求点名歧义词
  const priorOf = (raw) => {
    if (/必处理/.test(raw)) return 'multi';
    if (/低风险|大概率唯一/.test(raw)) return 'single';
    if (/禁入改写键/.test(raw)) return 'banned';
    return 'none';
  };
  const suspectTerms = [];
  for (const s of suspects) {
    const prior = priorOf(s.raw);
    const terms = s.group
      .split(/[、，,]/)
      .map((x) => x.replace(/[（(].*?[）)]/g, '').replace(/等$/, '').trim())
      .filter(Boolean)
      .filter((t) => t.length <= 6 || corpus.all.includes(t));
    for (const t of terms) suspectTerms.push({ term: t, source: '素材疑似节', prior, note: s.group });
  }
  for (const g of groups) {
    if (g.type === '官职/爵位类' && (g.canonical.length <= 6 || corpus.all.includes(g.canonical))) {
      suspectTerms.push({ term: g.canonical, source: '官职/爵位类', note: g.aliases.join('、') });
    }
  }
  // 人物节称号型别名（谥号/封号/头衔）纳入终审
  const TITLE_RE = /^(魏王|(?:.+)?(?:王|帝|侯|公|君|主|后|相|将军|太后|太傅|太尉|大夫|司徒|司空|尚书|都督|都尉|卿|皇叔))$/;
  for (const g of groups) {
    if (g.type !== '人物') continue;
    for (const a of [g.canonical, ...g.aliases]) {
      if (a.length < 2) continue;
      if (!TITLE_RE.test(a)) continue;
      if (a.length > 6 && !corpus.all.includes(a)) continue;
      suspectTerms.push({ term: a, source: '人物节称号', prior: 'none', note: '规范形:' + g.canonical });
    }
  }
  if (corpus.all.includes('魏王')) suspectTerms.push({ term: '魏王', source: '需求文档点名', prior: 'multi', note: '曹操/曹丕 共享头衔' });
  const dedup = new Map();
  for (const s of suspectTerms) {
    if (!dedup.has(s.term)) dedup.set(s.term, s);
  }
  const crossPersonTerms = new Set(
    [...conflicts.entries()]
      .filter(([, owners]) => owners.filter((o) => o.startsWith('人物::')).length >= 2)
      .map(([t]) => t)
  );
  const referents = [...dedup.values()].map((s) => ({
    ...s,
    ...referentDistribution(s.term, corpus, pidOfAlias, { crossPerson: crossPersonTerms.has(s.term), prior: s.prior }),
  }));
  referents.sort((a, b) => b.occurrences - a.occurrences);

  // 登场类拆细
  const debut = groups.find((g) => g.type === '登场类');
  const debutSplit = debut ? splitDebutAliases(debut.aliases) : null;

  // ---------- 报告 ----------
  const L = [];
  L.push('# FEAT-A016 术语口径差异统计报告（零 LLM）');
  L.push('');
  L.push('> 生成：' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '（UTC）｜脚本：test/term-diff/term-diff.mjs｜方法：核查分层 ①机械查重 → ②领域初审 → ③语料归属统计终审 → ④歧义语境核查。');
  L.push('');
  L.push('## 一、输入统计');
  L.push('');
  L.push('- 标准集（A015）：' + stdQuestions.length + ' 题（' + new Set(stdQuestions.map((q) => q.category)).size + ' 类）');
  L.push('- 线上 query（tool_retrieval_logs 去重）：' + onlineQueries.length + ' 条');
  L.push('- 现有别名表（alias.json）：' + Object.keys(aliasMap).length + ' 别名');
  L.push('- 素材底稿（sango-entity-normalization.md）：' + groups.length + ' 组（人物节 ' + groups.filter((g) => g.type === '人物').length + ' 组）');
  L.push('- 语料：' + corpus.titles.length + ' 回 / ' + corpus.chunkCount + ' chunk / ' + corpus.all.length + ' 字（回目 + 分块正文）');
  L.push('');

  L.push('## 二、必现案例对照（验收锚点）');
  L.push('');
  L.push('| 案例 | 规范形 | 别名（换说法） | 标准集题数 | 线上 query 条数 | 语料出现（回目/正文） | 说明 |');
  L.push('|---|---|---:|---:|---|---|---|');
  for (const a of anchors) {
    const stats = a.corpusStats.map((s) => s.term + ' ' + s.titleHits + '/' + s.bodyHits).join('；');
    const note = a.g.canonical === '过五关斩六将'
      ? '漏召根因（bug-00003）：过五关斩六将 无语面直配，改写链 = 五关斩六将（第27回回目锚）+ 千里走单骑（片段侧同义）'
      : '眼↔目 方位复合互换（左目/右目/双目 ↔ 左眼/右眼）；单字 目/眼 不作改写键，仅安全短语进片段侧素材';
    L.push('| ' + (a.g.canonical === '过五关斩六将' ? '过五关斩六将 ↔ 五关斩六将' : '左右目 ↔ 左右眼（眼↔目）') + ' | ' + a.g.canonical + ' | ' + (a.g.aliases.join('、') || '—') + ' | ' + a.std.length + ' | ' + a.online.length + ' | ' + stats + ' | ' + note + ' |');
  }
  L.push('');

  L.push('## 三、口径差异清单（query 侧实测命中）');
  L.push('');
  L.push('| 类型 | 规范形 | 别名（换说法） | 标准集命中 | 线上 query 命中 | 示例 |');
  L.push('|---|---|---|---:|---:|---|');
  for (const h of queryHits) {
    const ex = [...h.stdHits.slice(0, 2), ...h.onlineHits.map((q) => 'q:' + q.slice(0, 24))].slice(0, 3);
    L.push('| ' + typeLabel(h.type) + ' | ' + h.canonical + ' | ' + (h.aliases.join('、') || '—') + ' | ' + h.stdHits.length + ' | ' + h.onlineTotal + ' | ' + ex.join('；') + ' |');
  }
  L.push('');

  L.push('## 四、数字称谓子类（含数字的固定称谓，统计清单单列）');
  L.push('');
  L.push('| 类型 | 词 | 回目命中 | 正文命中 | query 命中 |');
  L.push('|---|---|---:|---:|---:|');
  for (const h of queryHits) {
    if (!h.numLike) continue;
    const c = corpusHits.find((x) => x.canonical === h.canonical);
    const tMax = c ? Math.max(...c.members.map((m) => m.titleHits)) : 0;
    const bMax = c ? Math.max(...c.members.map((m) => m.bodyHits)) : 0;
    L.push('| ' + typeLabel(h.type) + ' | ' + h.canonical + ' | ' + tMax + ' | ' + bMax + ' | ' + h.onlineTotal + ' |');
  }
  L.push('');

  L.push('## 五、语料侧素材核查（双侧归一化：query 与片段索引共用；不含人物，人物节增量见表起草）');
  L.push('');
  L.push('| 类型 | 规范形 | 成员 | 回目 | 正文 |');
  L.push('|---|---|---|---:|---:|');
  const nonPersonCorpus = corpusHits.filter((x) => x.type !== '人物');
  for (const c of nonPersonCorpus.slice(0, 60)) {
    for (const m of c.members) {
      L.push('| ' + typeLabel(c.type) + ' | ' + c.canonical + ' | ' + m.term + ' | ' + m.titleHits + ' | ' + m.bodyHits + ' |');
    }
  }
  if (nonPersonCorpus.length > 60) L.push('| … | 其余 ' + (nonPersonCorpus.length - 60) + ' 组见 data json | | | |');
  L.push('');

  L.push('## 六、歧义语境核查（④：单字 / 部分-整体词禁入防线）');
  L.push('');
  L.push('> 结论：带歧义复合词份额的词，改写键与片段侧单字替换均禁；器官类仅收「安全短语」为素材。');
  L.push('');
  L.push('| 词 | 目标语义 | 语料总出现 | 歧义短语（次数） | 安全短语（次数） | 判定 |');
  L.push('|---|---|---:|---|---|---|');
  for (const a of ambiguous) {
    const bad = a.bad.map(([k, n]) => k + 'x' + n).join('、') || '—';
    const good = a.good.map(([k, n]) => k + 'x' + n).join('、') || '—';
    const verdict = a.hasAmbiguity ? '**禁入改写键 + 禁片段侧单字替换**' : '单字仍禁入改写键（仅安全短语可收）';
    L.push('| ' + a.term + ' | ' + a.semantic + ' | ' + a.total + ' | ' + bad + ' | ' + good + ' | ' + verdict + ' |');
  }
  L.push('');

  L.push('## 七、跨主条目词语料归属核查（③终审：禁入改写键判定）');
  L.push('');
  const PRIOR_LABEL = { multi: '必处理歧义', single: '低风险唯一', banned: '泛官职裸词', none: '待定' };
  L.push('| 候选词 | 来源 | 初审 | 出现次数 | 归属窗口 | 邻近 PID 分布（top3） | 判定 |');
  L.push('|---|---|---|---:|---:|---:|---|');
  for (const r of referents) {
    const dist = r.dist.slice(0, 3).map(([p, n]) => p + 'x' + n).join('、') || '—';
    const align = /^(跨主条目|禁入改写键|泛称\/官职裸词)/.test(r.verdict) ? '**' + r.verdict + (r.verdict.includes('禁入改写键') ? '' : '（禁入改写键）') + '**' : r.verdict;
    L.push('| ' + r.term + ' | ' + typeLabel(r.source) + ' | ' + (PRIOR_LABEL[r.prior] ?? '—') + ' | ' + r.occurrences + ' | ' + r.windowCount + ' | ' + dist + ' | ' + align + ' |');
  }
  L.push('');

  L.push('## 八、机械查重冲突（①同串跨行）');
  L.push('');
  if (conflicts.size) {
    L.push('| 同串 | 归属组 |');
    L.push('|---|---|');
    for (const [term, owners] of conflicts) L.push('| ' + term + ' | ' + owners.join('、') + ' |');
  } else {
    L.push('无。');
  }
  L.push('');

  L.push('## 九、登场类跨语义行拆细（登场 / 亮相 / 出仕）');
  L.push('');
  if (debutSplit) {
    L.push('- 出场/亮相：' + (debutSplit.appear.join('、') || '—'));
    L.push('- 出仕/入仕：' + (debutSplit.office.join('、') || '—'));
    L.push('- 其他：' + (debutSplit.rest.join('、') || '—'));
  }
  L.push('');

  L.push('## 十、方法说明与已知约束');
  L.push('');
  L.push('- 零 LLM：全部统计为字符串匹配 + 邻近词计数；白名单式，只映射已确认条目。');
  L.push('- 单字词（目 / 口 / 头 / 死 / 亡等）不作 query 改写键，亦不作片段侧单字替换；片段侧只收语料实测安全短语。');
  L.push('- 年号类统一带年份短语键（如 建兴元年），防同词歧义。');
  L.push('- 登场类「登场 / 出仕 / 出山」为跨语义行，拆细为出场-亮相 / 出仕-入仕 两口径。');
  L.push('- 归属判定阈值：邻近人名窗口 ≥1 且首位 PID 占比 ≥80% → 唯一指称候选；否则跨主条目禁入改写键。');
  L.push('- 与素材预判不一致项（终审推翻初审）见 data json 中 verdict 为「唯一指称候选」但来源为「素材疑似节」的词，需人工复核。');
  L.push('- 歧义语境核查为白名单机制（AMBIGUOUS_CONTEXTS 固化），新增候选键时需同步补语境清单。');
  L.push('- ③终审共现窗口（±80 字）含场景级共现，既有初审分级（素材底稿必处理/低风险/裸词）+ ①同串跨人组 + 指称份额联合裁决；低风险词默认保留，除非同串跨人组推翻。');
  L.push('');

  const report = L.join('\n');
  mkdirSync(CFG.outDir, { recursive: true });
  writeFileSync(path.join(CFG.outDir, 'feat-A016-entity-diff-report.md'), report, 'utf8');

  const data = {
    generatedAt: new Date().toISOString(),
    inputs: {
      stdSet: CFG.stdSet,
      logsDb: CFG.logsDb,
      aliasJson: CFG.aliasJson,
      materialMd: CFG.materialMd,
      corpusDir: CFG.corpusDir,
      stdQuestionCount: stdQuestions.length,
      onlineQueryCount: onlineQueries.length,
      aliasCount: Object.keys(aliasMap).length,
      materialGroupCount: groups.length,
      corpusChapters: corpus.titles.length,
      corpusChunks: corpus.chunkCount,
      corpusChars: corpus.all.length,
    },
    queryHits,
    corpusHits,
    ambiguous,
    referents,
    conflicts: [...conflicts.entries()].map(([term, owners]) => ({ term, owners })),
    debutSplit,
  };
  writeFileSync(path.join(CFG.outDir, 'feat-A016-entity-diff-data.json'), JSON.stringify(data, null, 1), 'utf8');

  // ---------- 表起草（交付老陈：表设计 / 表合并输入） ----------
  const draftGroups = groups
    .filter((g) => g.type !== '人物')
    .map((g) => {
      const q = queryHits.find((h) => h.canonical === g.canonical && h.type === g.type);
      const c = corpusHits.find((x) => x.canonical === g.canonical);
      const organ = typeLabel(g.type) === '身体' ? ambiguous.find((a) => g.aliases.includes(a.term) || g.canonical === a.term) : null;
      const fragOnly = g.aliases.filter((a) => a.length === 1 || (organ && organ.bad.some(([k]) => k === a)));
      const rewriteKeys = g.aliases.filter((a) => a.length >= 2 && !fragOnly.includes(a));
      return {
        type: typeLabel(g.type),
        canonical: g.canonical,
        aliases: g.aliases,
        rewriteKeys,
        fragmentOnly: fragOnly,
        organGuard: organ ? { term: organ.term, semantic: organ.semantic, hasAmbiguity: organ.hasAmbiguity, safePhrases: organ.good.map(([k]) => k) } : null,
        queryHit: Boolean(q),
        corpusHit: Boolean(c),
        numLike: g.numLike,
      };
    })
    .filter((g) => g.queryHit || g.corpusHit);

  const personDraft = groups
    .filter((g) => g.type === '人物')
    .map((g) => {
      const pid = pidOfAlias[g.canonical] ?? null;
      const newAliases = g.aliases.filter((a) => !(a in aliasMap));
      return { type: '人物', id: pid, canonical: g.canonical, aliases: g.aliases, newAliases, inAliasJson: Boolean(pid) };
    });

  const draft = {
    generatedAt: new Date().toISOString(),
    note: '表起草（Coco），供老陈表设计 / 表合并使用；行 = type + id(PID) + 规范形 + 别名列表；冲突组 bug-00031 不进表；疑似跨主条目词以 referentVerdicts 判定为准；身体器官类以 organGuard 禁入口径为准（单字/歧义短语禁入，安全短语可收）。',
    person: personDraft,
    nonPerson: draftGroups,
    referentVerdicts: referents,
    ambiguityGuard: ambiguous,
  };
  writeFileSync(path.join(CFG.outDir, 'feat-A016-entity-table-draft.json'), JSON.stringify(draft, null, 1), 'utf8');

  // ---------- 控制台摘要 ----------
  const hitTypes = [...new Set(queryHits.map((h) => typeLabel(h.type)))];
  const conflictCount = conflicts.size;
  const cross = referents.filter((r) => r.verdict === '跨主条目').length;
  const unique = referents.filter((r) => r.verdict === '唯一指称候选').length;
  const ambiguousCount = ambiguous.filter((a) => a.hasAmbiguity).length;
  console.log('[A016] 标准集 ' + stdQuestions.length + ' 题 / 线上 query ' + onlineQueries.length + ' 条');
  console.log('[A016] query 命中组 ' + queryHits.length + '（类型 ' + hitTypes.length + ': ' + hitTypes.join('/') + '）');
  console.log('[A016] 语料命中组 ' + nonPersonCorpus.length + '（非人物）＋人物 ' + (corpusHits.length - nonPersonCorpus.length) + '；同串冲突 ' + conflictCount);
  console.log('[A016] 歧义语境核查：' + ambiguousCount + ' 词命中歧义复合词；歧义归属：跨主条目 ' + cross + ' / 唯一指称 ' + unique + ' / 其余 ' + (referents.length - cross - unique));
  console.log('[A016] 产物 → ' + CFG.outDir);
}

main();
