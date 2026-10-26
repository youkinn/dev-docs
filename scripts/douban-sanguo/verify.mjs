#!/usr/bin/env node
// 校验换代产出：文件哈希 / 120 回齐全与连续 / 逐回段落与字数 / 每条注的锚点可定位（bugs/bug-00068）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = { out: '' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') args.out = argv[++i];
  else if (argv[i] === '-h' || argv[i] === '--help') { console.log('用法：node verify.mjs --out <产出目录>'); process.exit(0); }
}
if (!args.out) { console.error('--out 必填'); process.exit(2); }

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const HUI_RE = /^第[一二三四五六七八九十百零]+回/;
const fails = [];
const fail = (msg) => { if (fails.length < 10) fails.push(msg); else if (fails.length === 10) fails.push('…（更多失败略）'); };

const p = (n) => path.join(args.out, n);
for (const n of ['三国演义.txt', 'sanguo-annotations.json', 'manifest.json']) {
  if (!fs.existsSync(p(n))) { console.error('缺少产物：' + n); process.exit(2); }
}
const manifest = JSON.parse(fs.readFileSync(p('manifest.json'), 'utf8'));
const txt = fs.readFileSync(p('三国演义.txt'), 'utf8');
const notes = JSON.parse(fs.readFileSync(p('sanguo-annotations.json'), 'utf8'));

if (manifest.files['三国演义.txt'] !== sha(txt)) fail('三国演义.txt 哈希与 manifest 不一致');
if (manifest.files['sanguo-annotations.json'] !== sha(fs.readFileSync(p('sanguo-annotations.json'), 'utf8'))) fail('sanguo-annotations.json 哈希与 manifest 不一致');

const chapters = [];
for (const line of txt.split(/\r?\n/)) {
  if (!line.trim()) continue;
  if (HUI_RE.test(line.trim())) chapters.push({ title: line.trim(), paragraphs: [] });
  else if (chapters.length) chapters[chapters.length - 1].paragraphs.push(line);
  else fail('正文首个非空行不是回目：' + line.slice(0, 20));
}
if (chapters.length !== manifest.counts.chapters) fail(`回数 ${chapters.length} ≠ manifest ${manifest.counts.chapters}`);
if (chapters.length !== 120) fail('回数不为 120：' + chapters.length);
const paras = chapters.reduce((s, c) => s + c.paragraphs.length, 0);
const chars = chapters.reduce((s, c) => s + c.paragraphs.reduce((a, x) => a + x.length, 0), 0);
if (paras !== manifest.counts.paragraphs) fail(`段落数 ${paras} ≠ manifest ${manifest.counts.paragraphs}`);
if (chars !== manifest.counts.bodyChars) fail(`正文字数 ${chars} ≠ manifest ${manifest.counts.bodyChars}`);

chapters.forEach((c, i) => {
  const m = manifest.chapters[i];
  if (!m) { fail('manifest 缺少第 ' + (i + 1) + ' 回'); return; }
  if (m.no !== i + 1) fail('第 ' + (i + 1) + ' 回编号不连续：manifest.no=' + m.no);
  if (m.title !== c.title) fail('第 ' + (i + 1) + ' 回回目不一致：' + c.title.slice(0, 24) + ' vs ' + String(m.title).slice(0, 24));
  if (m.paragraphs !== c.paragraphs.length) fail('第 ' + (i + 1) + ' 回段落数不一致');
  const cm = c.paragraphs.reduce((a, x) => a + x.length, 0);
  if (m.chars !== cm) fail('第 ' + (i + 1) + ' 回字数不一致');
});

const byNo = new Map(chapters.map((c) => [manifest.chapters[chapters.indexOf(c)] ? manifest.chapters[chapters.indexOf(c)].no : 0, c]));
let noteOk = 0;
for (const n of notes) {
  const ch = chapters[n.chapter - 1];
  if (!ch) { fail('注指向不存在的回：' + n.chapter); continue; }
  const para = ch.paragraphs[n.paraIndex - 1];
  if (para === undefined) { fail(`第${n.chapter}回 第${n.paraIndex}段不存在`); continue; }
  if (n.offset < 0 || n.offset > para.length) { fail(`第${n.chapter}回 第${n.paraIndex}段 offset 越界：${n.offset}/${para.length}`); continue; }
  const before = para.slice(Math.max(0, n.offset - 16), n.offset);
  const after = para.slice(n.offset, n.offset + 16);
  if (before !== n.anchorBefore || after !== n.anchorAfter) { fail(`第${n.chapter}回 第${n.paraIndex}段 offset ${n.offset} 锚点不匹配`); continue; }
  noteOk += 1;
}
if (notes.length !== manifest.counts.notes) fail(`注数 ${notes.length} ≠ manifest ${manifest.counts.notes}`);
if (noteOk !== notes.length) fail(`注锚点命中 ${noteOk}/${notes.length}`);

console.log('回数=' + chapters.length + ' 段落=' + paras + ' 正文=' + chars + ' 字 注=' + notes.length + '（锚点命中 ' + noteOk + '）');
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('PASS');
