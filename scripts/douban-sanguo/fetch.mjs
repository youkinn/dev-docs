#!/usr/bin/env node
// 豆瓣阅读《三国演义》三册抓取 + 解密（bugs/bug-00068）
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const VOLS = [
  { aid: '155370967', tag: 'vol1', label: '上（第一至四十回）' },
  { aid: '155370735', tag: 'vol2', label: '中（第四十一至八十回）' },
  { aid: '155370876', tag: 'vol3', label: '下（第八十一至一百二十回）' },
];
const readerUrl = (aid) => 'https://read.douban.com/reader/ebook/' + aid + '/';

function usage() {
  console.log(`用法：
  node fetch.mjs --profile <浏览器配置目录> [--out <输出目录>] [--login] [--timeout-min N]

  --profile      必填。专用 Chrome 配置目录，登录态存在这里（不要用默认配置目录）
  --out          输出目录，默认 ./dump，落 vol{1,2,3}_plain.json
  --login        打开窗口等待人工登录豆瓣（首次或登录态失效时用），完成后退出
  --timeout-min  登录等待上限（分钟），默认 8`);
}
const args = { profile: '', out: './dump', login: false, timeoutMin: 8 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k === '--profile') args.profile = argv[++i];
  else if (k === '--out') args.out = argv[++i];
  else if (k === '--login') args.login = true;
  else if (k === '--timeout-min') args.timeoutMin = Number(argv[++i]);
  else if (k === '-h' || k === '--help') { usage(); process.exit(0); }
}
if (!args.profile) { console.error('缺少 --profile'); usage(); process.exit(2); }

function decrypt(b64, userId) {
  const key = crypto.createHash('sha256').update(String(userId)).digest();
  const buf = Buffer.from(b64, 'base64');
  const cut = buf.length - 16 - 13;
  const d = crypto.createDecipheriv('aes-256-cbc', key, buf.subarray(cut, cut + 16));
  return Buffer.concat([d.update(buf.subarray(0, cut)), d.final()]).toString('utf8');
}

fs.mkdirSync(args.out, { recursive: true });
const ctx = await chromium.launchPersistentContext(args.profile, {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-sync'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

if (args.login) {
  await page.goto(readerUrl(VOLS[0].aid), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  console.log('请在打开的窗口里登录豆瓣（推荐扫码），登录后脚本自动继续。');
  const deadline = Date.now() + args.timeoutMin * 60000;
  let ok = false;
  while (Date.now() < deadline) {
    const cs = await ctx.cookies('https://www.douban.com/').catch(() => []);
    if (cs.some((c) => c.name === 'dbcl2')) { ok = true; break; }
    await page.waitForTimeout(4000);
  }
  console.log('logged_in=' + ok);
  await ctx.close();
  process.exit(ok ? 0 : 1);
}

await page.goto(readerUrl(VOLS[0].aid), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(6000);
const session = await page.evaluate(() => ({
  id: window.Ark && window.Ark.user && window.Ark.user.id,
  csrf: window.Ark && window.Ark.CSRF_TOKEN,
  anon: window.Ark && window.Ark.user && window.Ark.user.isAnonymous,
}));
if (!session.id || session.anon) {
  console.error('未登录或取不到用户 id，请先执行 --login');
  await ctx.close();
  process.exit(1);
}
console.log('user_id=' + session.id);

for (const v of VOLS) {
  const res = await ctx.request.post('https://read.douban.com/j/article_v2/get_reader_data', {
    form: { aid: v.aid },
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': session.csrf || '' },
  });
  if (res.status() !== 200) { console.error(v.tag + ' HTTP ' + res.status()); process.exitCode = 1; continue; }
  const payload = await res.json();
  if (payload.is_sample) { console.error(v.tag + ' 返回试读样本（is_sample=1）：账号对该册无阅读权限'); process.exitCode = 1; continue; }
  const plain = decrypt(payload.data, session.id);
  const file = path.join(args.out, v.tag + '_plain.json');
  fs.writeFileSync(file, plain);
  console.log(v.tag + ' ' + v.label + ' 解密后 ' + plain.length + ' 字符 -> ' + file);
}
await ctx.close();
