import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_ROOT = path.resolve(__dirname, '../../../mcp-server/sango');
const CORPUS_DIR = path.join(MCP_SERVER_ROOT, 'data/corpus/sanguo-yanyi');
const ENTITY_PATH = path.join(MCP_SERVER_ROOT, 'data/entity-table.json');
const OUT_PATH = path.join(MCP_SERVER_ROOT, 'data/corpus/events.json');
const FIRST_PASS = path.join(__dirname, 'first-pass.md');
const GAP_PATH = path.join(__dirname, 'gap.md');

const rows = fs.readFileSync(FIRST_PASS, 'utf8').split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /^\|\s*\d{3}\s*\|/.test(l))
  .map((l) => {
    const p = l.split('|').map((s) => s.trim());
    return { hui: p[1], name: p[2], ask: p[3], type: p[4], remark: p[5] || '' };
  });

const entity = JSON.parse(fs.readFileSync(ENTITY_PATH, 'utf8'));
const entityRows = entity.rows || [];
const rewriteKeys = new Set(entityRows.flatMap((r) => r.rewriteKeys || []));

let chunkCount = 0;
for (let h = 1; h <= 120; h++) {
  const hui = String(h).padStart(3, '0');
  const doc = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, hui + '.json'), 'utf8'));
  chunkCount += (doc.chunks || []).length;
}

const nameToCanon = new Map();
for (const r of entityRows) {
  const words = new Set([r.canonical, ...(r.aliases || []), ...(r.rewriteKeys || [])]);
  for (const w of words) if (w && w.length >= 2 && !nameToCanon.has(w)) nameToCanon.set(w, r.canonical);
}

const personCanons = new Map();
for (const r of entityRows) {
  if (r.type === '人物' && r.canonical) personCanons.set(r.canonical, new Set([r.canonical, ...(r.aliases || []), ...(r.rewriteKeys || [])]));
}

const PERSON_NORM = { '叡': '睿' };
function normPerson(p) {
  let out = p;
  for (const [a, b] of Object.entries(PERSON_NORM)) out = out.split(a).join(b);
  return out;
}

function canonOfPerson(person) {
  const np = normPerson(person);
  for (const [canon] of personCanons) {
    if (canon === np || np.includes(canon) || canon.includes(np)) return canon;
  }
  return null;
}

const L3_MARKER = /^(.+?)(之死|病死|病故|病亡|被杀|被斩|被诛|遇害|之亡|之薨|授首|登场)$/;
const DEATH_WORDS = /(死|杀|病|亡|故|薨|崩|殒|卒|斩|诛|剁|缢|刎|自刎|授首|遇害|杖毙)/;

function parseRange(remark) {
  const m = remark.match(/跨\s*(\d{3})\s*[\u2013\u2014-]\s*(\d{3})/);
  if (!m) return null;
  return { from: m[1], to: m[2] };
}

function entityKeywordsOf(name) {
  // 命中事件名的实体行：canonical + 词本身 + 该行 aliases/rewriteKeys（正文常以别称指称，如 刘备→汉中王/先主）
  const out = new Set();
  for (const [word, canon] of nameToCanon) {
    if (name.includes(word)) {
      out.add(word);
      out.add(canon);
      const r = entityRows.find((x) => x.canonical === canon);
      if (r) for (const a of [...(r.aliases || []), ...(r.rewriteKeys || [])]) if (a.length >= 2) out.add(a);
    }
  }
  return [...out];
}

function bigramsOf(name) {
  // 2-gram；排除以虚词 / 「战」「计」结尾的 gram（之战/之计），保留「战船」类（战在字头）
  const out = [];
  for (let i = 0; i + 1 < name.length; i++) {
    const g = name.slice(i, i + 2);
    if (!/([之的了与和及并于以计战])$/.test(g)) out.push(g);
  }
  return [...new Set(out)];
}

function personKeywords(person) {
  const canon = canonOfPerson(person);
  return canon ? [...(personCanons.get(canon) || [person])] : [person];
}

// 人工补关键词（Coco 依原文核证，登记 gap.md「人工关键词」节；长期机制走缺口回流）
const KW_OVERRIDE = {
  '捉放曹': ['曹操', '孟德', '陈宫'],
  '舌战群儒': ['孔明', '张昭', '诸葛亮'],
  '锁战船': ['战船', '曹操'],
  '割须弃袍': ['马超', '西凉', '割髯'],
  '高平陵之变': ['曹爽', '司马懿', '永宁宫'],
  '姜叙母之死': ['姜叙', '叙母'],
  '司马徽登场': ['水镜'],
  '徐庶登场': ['单福'],
  '三顾草庐': ['茅庐'],
  '空城计': ['西城'],
  '草船借箭': ['束草'],
  '挂印封金': ['印'],
  '夷陵之战': ['猇亭', '先主伐吴'],
  '智取三城': ['南安', '安定', '天水'],
  '二士争功': ['邓艾', '钟会'],
  '蜀汉灭亡': ['刘禅', '出降'],
  '曹魏灭亡': ['曹奂', '禅位'],
  '三分归一统': ['司马炎', '一统'],
  // 待核：017 阎象登场（原文无「阎象」）、050 蔡中之死（050 为诈降非死亡）——tags 源数据疑误标，缺口登记
};

function loadDoc(hui) {
  return JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, hui + '.json'), 'utf8'));
}

const warnings = [];
const missed = [];
const conflictDropped = [];
const suspect = []; // 死亡事件：回内有人名但无「人名+死词」共现 chunk（tags/初审存疑，待人核）

// 重名人物事件 aliases 限定（防跨行重复，正文职称/身份佐证；登记 gap.md）
const ALIAS_OVERRIDE = {
  '066|穆顺之死': ['宦官穆顺之死', '宦官穆顺身亡', '宦官穆顺遇害'],
  '084|张南之死': ['蜀将张南之死', '蜀将张南战死', '随军张南之死'],
};

const ALIAS_FALLBACK = {
  '千里走单骑': ['单骑千里'],
  '隆中对': ['隆中对策'],
  '火烧赤壁': ['赤壁之战'],
  '七擒孟获': ['七纵七擒'],
};

const events = [];
const seenInHui = new Map();
const seenNameHui = new Set();

for (const row of rows) {
  const range = parseRange(row.remark);
  const from = range ? range.from : row.hui;
  const to = range ? range.to : row.hui;

  let person = null;
  let keywords = [];
  let isBirth = false;
  if (row.type === 'L3') {
    const m = row.name.match(L3_MARKER);
    if (m) {
      person = m[1];
      isBirth = /(登场|出场)/.test(row.name);
      keywords = personKeywords(person);
    } else {
      warnings.push(row.hui + ' ' + row.name + '：L3 事件名缺人物后缀，无法定位');
    }
  } else {
    // L1/L2：全名 + 实体词（含行内别名/改写键）+ 2-gram 叠加，宁多勿漏
    keywords = [row.name, ...entityKeywordsOf(row.name), ...bigramsOf(row.name)];
  }
  const extra = KW_OVERRIDE[row.name] || [];
  if (extra.length) keywords = keywords.filter((k) => !extra.includes(k)).concat(extra);

  const chunkIds = [];
  let hitPersonChunk = 0;
  let hitCooccur = 0;
  for (let h = Number(from); h <= Number(to); h++) {
    const hui = String(h).padStart(3, '0');
    const doc = loadDoc(hui);
    const huiHasName = row.type === 'L3' && person
      ? doc.chunks.some((c) => keywords.some((k) => c.text.includes(k)))
      : false;
    for (const c of doc.chunks) {
      if (row.type === 'L3') {
        if (!person) continue;
        const hasName = keywords.some((k) => c.text.includes(k));
        if (isBirth) {
          if (hasName) chunkIds.push(c.id);
        } else {
          if (hasName) {
            chunkIds.push(c.id);
            if (DEATH_WORDS.test(c.text)) hitCooccur++;
            else hitPersonChunk++;
          } else if (DEATH_WORDS.test(c.text) && huiHasName) {
            chunkIds.push(c.id);
          }
        }
      } else if (keywords.some((k) => c.text.includes(k))) {
        chunkIds.push(c.id);
      }
    }
  }
  if (chunkIds.length === 0) {
    missed.push(row.hui + ' ' + row.name + '（' + row.type + '）');
    continue; // 待核事件不进表（verify 要求每行 chunkIds 非空），登记缺口待核证
  }
  if (row.type === 'L3' && !isBirth && person && hitPersonChunk > 0 && hitCooccur === 0) {
    suspect.push(row.hui + ' ' + row.name + '：回内有人名但无人名+死词共现（tags/事件存疑待核）');
  }

  let aliases = [row.name];
  if (person) {
    if (isBirth) {
      aliases.push(person + '出场', person + '首次登场');
    } else {
      aliases.push(person + '死亡', person + '去世');
    }
  }
  const ao = ALIAS_OVERRIDE[row.hui + '|' + row.name];
  if (ao) {
    aliases = ao;
  }
  let kept = aliases.filter((a) => {
    if (rewriteKeys.has(a)) {
      conflictDropped.push(row.hui + ' ' + row.name + '：alias「' + a + '」与实体表改写键冲突，已剔除');
      return false;
    }
    return true;
  });
  if (kept.length === 0) {
    const fb = (ALIAS_FALLBACK[row.name] || []).filter((a) => !rewriteKeys.has(a));
    if (fb.length) {
      kept = fb;
      warnings.push(row.hui + ' ' + row.name + '：aliases 全被改写键剔除，已用人工补别名 ' + fb.join('/') + '（gap.md 登记）');
    }
  }

  const characters = [];
  if (person) {
    const canon = canonOfPerson(person);
    characters.push(canon || person);
  } else {
    for (const [word, canon] of nameToCanon) {
      if (row.name.includes(word)) {
        const r = entityRows.find((x) => x.canonical === canon);
        if (r && r.type === '人物' && !characters.includes(canon)) characters.push(canon);
      }
    }
  }

  const seq = (seenInHui.get(row.hui) || 0) + 1;
  seenInHui.set(row.hui, seq);
  const eventId = 'E' + row.hui + String(seq).padStart(2, '0');
  const nameHuiKey = row.hui + '|' + row.name;
  if (seenNameHui.has(nameHuiKey)) warnings.push(nameHuiKey + '：同回事件名重复');
  seenNameHui.add(nameHuiKey);

  const exampleQuestion = (row.ask.split(/[?？。；;]/)[0] || row.ask).trim();

  const ev = {
    eventId,
    eventName: row.name,
    aliases: kept,
    chunkIds,
    type: row.type,
    exampleQuestion,
    ...(range ? { crossChapter: range.from + '\u2013' + range.to } : {}),
    ...(characters.length ? { characters } : {}),
  };
  events.push(ev);
}

events.sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));

const rowsOut = events;
const normVersion = createHash('sha256').update(JSON.stringify(rowsOut)).digest('hex').slice(0, 8);
const out = {
  meta: {
    schemaVersion: 1,
    normVersion,
    generatedAt: new Date().toISOString(),
    corpusChunkCount: chunkCount,
  },
  rows: rowsOut,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1) + '\n', 'utf8');

const eventCount = rowsOut.length;
const byType = {};
for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;

console.log('events:', eventCount, JSON.stringify(byType));
console.log('normVersion:', normVersion);
console.log('chunks referenced:', new Set(events.flatMap((e) => e.chunkIds)).size, '/', chunkCount);
const avg = (events.reduce((s, e) => s + e.chunkIds.length, 0) / eventCount).toFixed(1);
console.log('avg chunkIds/event:', avg);
console.log('missed (待核，不进表):', missed.length);
if (missed.length) console.log(missed.join('\n'));
console.log('suspect (death w/o cooccur):', suspect.length);
if (suspect.length) console.log(suspect.join('\n'));
console.log('conflict-dropped aliases:', conflictDropped.length);
console.log('warnings:', warnings.length);
if (warnings.length) console.log(warnings.slice(0, 10).join('\n'));
console.log('out:', OUT_PATH);