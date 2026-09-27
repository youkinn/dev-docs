import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tagsPath = path.resolve(__dirname, '../../../mcp-server/sango/data/corpus/tags/event.json');
const outPath = path.join(__dirname, 'first-pass.md');

const tags = JSON.parse(fs.readFileSync(tagsPath, 'utf8'));

// 1. tags 派生 L3（逐 chunk 展开，一行一(回,事件)，不做跨回）
const derived = new Map();
const byDeath = new Map(), byBirth = new Map();
for (const [chunkId, val] of Object.entries(tags)) {
  const rev = String(chunkId.split(':')[1] || '').trim();
  const hui = String(parseInt(rev, 10) || 0).padStart(3, '0');
  if (!/^\d{3}$/.test(hui)) continue;
  for (const tag of String(val).split('|').map((s) => s.trim()).filter(Boolean)) {
    let person = null, isDeath = false;
    if (tag.startsWith('人物之死-')) { person = tag.slice(5); isDeath = true; }
    else if (tag.startsWith('人物之生-')) { person = tag.slice(5); }
    if (!person) continue;
    person = person.replace(/(之死|登场)$/, '');
    const eventName = isDeath ? `${person}之死` : `${person}登场`;
    const ask = isDeath ? `${person}是怎么死的？` : `${person}是什么时候出场的？`;
    const key = `${hui}|${eventName}`;
    if (!derived.has(key)) derived.set(key, `| ${hui} | ${eventName} | ${ask} | L3 | tags:event.json |`);
    const bucket = isDeath ? byDeath : byBirth;
    if (!bucket.has(person)) bucket.set(person, new Set());
    bucket.get(person).add(hui);
  }
}

// 2. 读现有文件：L1/L2 全保留；手工 L3 一律不并入，未入 tags 的列为补录候选
const lines = fs.readFileSync(outPath, 'utf8').split(/\r?\n/);
const header = lines.filter((l, i) => i < 2 && l.startsWith('|'));
const keep = [];
const candidates = [];
for (const row of lines.filter((l) => /^\| \d{3} \|/.test(l))) {
  const p = row.split('|').map((s) => s.trim());
  const t = p[4];
  if (t === 'L1' || t === 'L2') { keep.push(row); continue; }
  if (t === 'L3') {
    const name = p[2];
    if (/补录/.test(p[5] || '')) { keep.push(row); continue; }
    const isBirth = /登场|出场/.test(name);
    const isDeath = !isBirth && /死|亡|故|殁|薨|杀|授首/.test(name);
    const hit = [...(isDeath ? byDeath : isBirth ? byBirth : [])].filter(([person]) => name.includes(person));
    if (hit.length === 0) candidates.push(`${p[1]} ${name}`);
  }
}

// 3. L1/L2 死亡名场面与 tags 死亡行重叠（供拍板，不自动处理）
const epicHit = [];
for (const row of keep) {
  const p = row.split('|').map((s) => s.trim());
  const name = p[2];
  if (!/斩|杀|诛|死|亡/.test(name)) continue;
  const hit = [...byDeath].filter(([person]) => name.includes(person)).map(([p]) => p);
  if (hit.length) epicHit.push(`${p[1]} ${name}（L${Number(p[4][1])}）→ tags:${hit.join('/')}`);
}

// 4. 合并输出
const all = [...keep, ...derived.values()].map((row) => {
  const p = row.split('|').map((s) => s.trim());
  return { hui: p[1], type: p[4], row };
});
all.sort((a, b) => a.hui === b.hui ? (a.type === b.type ? 0 : a.type < b.type ? -1 : 1) : a.hui < b.hui ? -1 : 1);
fs.writeFileSync(outPath, [...header, ...all.map((x) => x.row)].join('\r\n') + '\r\n', 'utf8');
const fin = [...header, ...all.map((x) => x.row)].filter((l) => /^\| \d{3} \|/.test(l));
const cat = {};
for (const r of fin) { const t = r.split('|')[4].trim(); cat[t] = (cat[t] || 0) + 1; }
console.log('final rows:', fin.length, JSON.stringify(cat));
console.log('--- 手工 L3 未入 tags（补录候选，待二审确认后进 gap.md）---');
console.log(candidates.join('\n') || '(无)');
console.log('--- L1/L2 死亡名场面 vs tags 死亡行（问法不同，是否保留请拍板）---');
console.log(epicHit.join('\n') || '(无)');