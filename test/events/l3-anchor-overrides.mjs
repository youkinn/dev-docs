// L3 行锚点人工核证（tags 未覆盖 / 回号纠正行的机器口径；gap.md「L3 锚点人工核证」为人工留痕）
// 键 = eventId；值 = 锚点段 chunkId 数组（标签位点段，重建时按 L3_ANCHOR_N 前后扩展）
export const L3_ANCHOR_OVERRIDES = {
  'E00104': ['sanguo-yanyi:0001:c0006'], // 张角之死：原文无死亡场景（病故未正面叙述），暂取举兵段，待核
  'E02402': ['sanguo-yanyi:0024:c0003'], // 董承之死：曹操既杀了董承等众人
  'E03303': ['sanguo-yanyi:0033:c0016'], // 二袁授首：公孙康伏刀斧手斩袁尚袁熙，木匣送易州
  'E03507': ['sanguo-yanyi:0035:c0009'], // 刘琦登场：刘表使长子刘琦（tags 039 误标，首出 035）
  'E05803': ['sanguo-yanyi:0058:c0006'], // 钟进被杀：庞德一刀斩钟进于马下
  'E06004': ['sanguo-yanyi:0060:c0001'], // 张松登场：益州别驾张松字永年（tags 059 误标，060 才报名）
  'E06103': ['sanguo-yanyi:0061:c0012'], // 张纮病故：人报长史张纮辞疾回家，今已病故
  'E09103': ['sanguo-yanyi:0091:c0018'], // 马超病故：孔明「马孟起病故，吾甚惜之」
  'E10402': ['sanguo-yanyi:0104:c0007'], // 李严病死：李严闻之，亦大哭病死
  'E10603': ['sanguo-yanyi:0106:c0013'], // 曹叡之死：睿执司马懿手托孤（病危）；c0014 谥/葬高平陵
  'E11103': ['sanguo-yanyi:0111:c0012'], // 孙峻病亡：此时东吴丞相孙峻病亡，从弟孙綝辅政
};

/** 锚点 ±N 档位常量（v1 = 1，回测口；接口 §3.3 ② N ∈ 1..3）。 */
export const L3_ANCHOR_N = 1;

const L3_MARKER = /^(.+?)(之死|病死|病故|病亡|被杀|被斩|被诛|遇害|之亡|之薨|授首|登场)$/;
const PERSON_NORM = { '叡': '睿' };

/** 建 tags 锚点索引：'hui|person|D|B' → [chunkId]。 */
export function buildTagAnchorIndex(tagsRaw) {
  const index = new Map();
  for (const [cid, val] of Object.entries(tagsRaw)) {
    const hui = String(parseInt(cid.split(':')[1], 10) || 0).padStart(3, '0');
    for (const t of String(val).split('|')) {
      let person = null;
      let isDeath = false;
      if (t.startsWith('人物之死-')) { person = t.slice(5).replace(/(之死|登场)$/, ''); isDeath = true; }
      else if (t.startsWith('人物之生-')) { person = t.slice(5).replace(/(之死|登场)$/, ''); }
      if (!person) continue;
      const key = `${hui}|${person}|${isDeath ? 'D' : 'B'}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(cid);
    }
  }
  return index;
}

/** 按 tags 索引查行锚点；未命中返回 null（调用方走 L3_ANCHOR_OVERRIDES）。 */
export function lookupTagAnchors(index, hui, eventName) {
  const m = eventName.match(L3_MARKER);
  if (!m) return null;
  const person = m[1];
  const isDeath = !/登场|出场/.test(eventName);
  const suffix = isDeath ? 'D' : 'B';
  const hit = index.get(`${hui}|${person}|${suffix}`);
  if (hit && hit.length) return hit;
  const norm = person.split('').map((c) => PERSON_NORM[c] || c).join('');
  const hitNorm = index.get(`${hui}|${norm}|${suffix}`);
  return hitNorm && hitNorm.length ? hitNorm : null;
}

/** 锚点 ±N 小位点组（凸包；超 5 段从边裁非锚点、保锚点；结果 2-5 段，同回）。 */
export function buildL3AnchorGroup(anchors, chapterChunkCount) {
  const N = L3_ANCHOR_N;
  const hui = anchors[0].split(':')[1];
  const poss = new Set();
  for (const a of anchors) {
    const p = Number(a.split(':c')[1]);
    for (let d = -N; d <= N; d++) poss.add(p + d);
  }
  const arr = [...poss].filter((p) => p >= 1 && p <= chapterChunkCount).sort((a, b) => a - b);
  const anchorSet = new Set(anchors.map((a) => Number(a.split(':c')[1])));
  while (arr.length > 5) {
    if (!anchorSet.has(arr[0])) arr.shift();
    else arr.pop();
  }
  return arr.map((p) => `sanguo-yanyi:${hui}:c${String(p).padStart(4, '0')}`);
}