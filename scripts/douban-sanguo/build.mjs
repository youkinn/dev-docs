#!/usr/bin/env node
// 由抓取产物（vol{1,2,3}_plain.json）生成底本文本、注解数据与 manifest（bugs/bug-00068）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = { dump: './dump', out: '' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dump') args.dump = argv[++i];
  else if (argv[i] === '--out') args.out = argv[++i];
  else if (argv[i] === '-h' || argv[i] === '--help') {
    console.log('用法：node build.mjs --dump <抓取产物目录> --out <输出目录>\n\n--out 必填：写到 docs/ 即完成换底本，故不设默认值，避免误覆盖语料。');
    process.exit(0);
  }
}
if (!args.out) { console.error('--out 必填（避免误覆盖 docs/ 语料）'); process.exit(2); }

const VOLS = [
  { aid: '155370967', tag: 'vol1', label: '上（第一至四十回）' },
  { aid: '155370735', tag: 'vol2', label: '中（第四十一至八十回）' },
  { aid: '155370876', tag: 'vol3', label: '下（第八十一至一百二十回）' },
];
const HUI_RE = /^第[一二三四五六七八九十百零]+回/;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const chapters = [];
const notes = [];
const frontMatter = [];
const sources = [];
let chapterNo = 0;

for (const v of VOLS) {
  const file = path.join(args.dump, v.tag + '_plain.json');
  if (!fs.existsSync(file)) throw new Error('缺少抓取产物：' + file);
  const text = fs.readFileSync(file, 'utf8');
  const raw = JSON.parse(text);
  if (raw.is_sample) throw new Error(v.tag + ' 是试读样本（is_sample=1），不能用于换代');
  sources.push({ aid: v.aid, tag: v.tag, label: v.label, bytes: Buffer.byteLength(text), sha256: sha(text) });

  let cur = null;
  let started = false;
  for (const item of raw.posts[0].contents) {
    if (item.type === 'pagebreak' || item.type === 'illus') continue;
    const data = item.data || {};
    if (item.type === 'headline') {
      const title = String(data.text || '').replace(/\s+/g, ' ').trim();
      if (HUI_RE.test(title)) {
        chapterNo += 1;
        cur = { no: chapterNo, title, paragraphs: [] };
        chapters.push(cur);
        started = true;
      } else {
        frontMatter.push('# ' + title);
      }
      continue;
    }
    if (item.type !== 'paragraph') continue;
    const t = data.text;
    let body = '';
    const local = [];
    if (typeof t === 'string') {
      body = t;
    } else if (Array.isArray(t)) {
      for (const e of t) {
        if (e.kind === 'footnote') local.push({ offset: body.length, note: e.content || '' });
        else body += e.content || '';
      }
    }
    if (!body.trim()) continue;
    if (!started) { frontMatter.push(body); continue; }
    cur.paragraphs.push(body);
    const paraIndex = cur.paragraphs.length;
    for (const n of local) {
      notes.push({
        chapter: cur.no,
        chapterTitle: cur.title,
        paraIndex,
        offset: n.offset,
        anchorBefore: body.slice(Math.max(0, n.offset - 16), n.offset),
        anchorAfter: body.slice(n.offset, n.offset + 16),
        note: n.note,
      });
    }
  }
}

if (chapters.length !== 120) throw new Error('回数不为 120：' + chapters.length);

const bodyBlocks = [];
for (const ch of chapters) {
  bodyBlocks.push(ch.title);
  for (const p of ch.paragraphs) bodyBlocks.push(p);
}
const bodyText = bodyBlocks.join('\n\n') + '\n';
const notesJson = JSON.stringify(notes, null, 1) + '\n';
const frontText = frontMatter.length ? frontMatter.join('\n\n') + '\n' : '';

fs.mkdirSync(args.out, { recursive: true });
for (const [name, content] of [['三国演义.txt', bodyText], ['sanguo-annotations.json', notesJson], ['front-matter.txt', frontText]]) {
  if (content) fs.writeFileSync(path.join(args.out, name), content);
}
const manifest = {
  generatedAt: new Date().toISOString(),
  sources,
  counts: {
    chapters: chapters.length,
    paragraphs: chapters.reduce((s, c) => s + c.paragraphs.length, 0),
    notes: notes.length,
    bodyChars: chapters.reduce((s, c) => s + c.paragraphs.reduce((a, p) => a + p.length, 0), 0),
  },
  chapters: chapters.map((c) => ({ no: c.no, title: c.title, paragraphs: c.paragraphs.length, chars: c.paragraphs.reduce((a, p) => a + p.length, 0) })),
  files: {
    '三国演义.txt': sha(bodyText),
    'sanguo-annotations.json': sha(notesJson),
    'front-matter.txt': sha(frontText),
  },
};
fs.writeFileSync(path.join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log('回数=' + manifest.counts.chapters + ' 段落=' + manifest.counts.paragraphs + ' 正文=' + manifest.counts.bodyChars + ' 字 注=' + manifest.counts.notes);
console.log('输出目录：' + path.resolve(args.out));
