import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tagsPath = path.resolve(__dirname, '../../../mcp-server/sango/data/corpus/tags/event.json');
const outPath = path.join(__dirname, 'first-pass.md');

const tags = JSON.parse(fs.readFileSync(tagsPath, 'utf8'));

// 1. 派生 L3：逐 chunk 打标原样展开，一行一(回,事件)，不折叠、不造跨回
const byPerson = new Map(); // person -> Set(回)
const derived = new Map();  // 回|事件名 -> row
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
    if (!byPerson.has(person)) byPerson.set(person, new Set());
    byPerson.get(person).add(hui);
  }
}
console.log('derived (回,事件) rows:', derived.size);

// 2. 读现有初审材料，手工 L3 与派生同(回,人物)重复的丢弃
const lines = fs.readFileSync(outPath, 'utf8').split(/\r?\n/);
const header = lines.filter((l, i) => i < 2 && l.startsWith('|'));
const dataRows = lines.filter((l) => /^\| \d{3} \|/.test(l));
const keep = [];
let dropped = 0;
for (const row of dataRows) {
  const p = row.split('|').map((s) => s.trim());
  const hui = p[1], name = p[2], type = p[4];
  if (type !== 'L3') { keep.push(row); continue; }
  const covered = derived.has(`${hui}|${name}`) ||
    [...byPerson].some(([person, hus]) => name.includes(person) && hus.has(hui));
  if (covered) dropped++; else keep.push(row);
}
console.log('kept manual:', keep.length, 'dropped manual L3:', dropped);

// 3. 合并排序写出
const all = [...keep, ...derived.values()].map((row) => {
  const p = row.split('|').map((s) => s.trim());
  return { hui: p[1], type: p[4], row };
});
all.sort((a, b) => a.hui === b.hui ? (a.type === b.type ? 0 : a.type < b.type ? -1 : 1) : a.hui < b.hui ? -1 : 1);
const out = [...header, ...all.map((x) => x.row)];
fs.writeFileSync(outPath, out.join('\r\n') + '\r\n', 'utf8');
const rows = out.filter((l) => /^\| \d{3} \|/.test(l));
console.log('final rows:', rows.length);
const cat = {};
for (const r of rows) { const t = r.split('|')[4].trim(); cat[t] = (cat[t] || 0) + 1; }
console.log('type dist:', JSON.stringify(cat));