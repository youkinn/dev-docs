# 豆瓣阅读《三国演义》抓取 / 构建 / 校验（bug-00068）

底本换代的取数工具链。来源为豆瓣阅读人民文学出版社版《三国演义》三册，用途限内部语料。

## 前置

- Node 22+，`npm i`（仅 `fetch.mjs` 需要 `playwright-core`；本机 Chrome 需已安装，脚本用 `channel: chrome` 起真实浏览器）
- 一个具备阅读权限（购买或会员）的豆瓣账号
- 三册 ebook id 见 `fetch.mjs` 顶部 `VOLS`

## 用法

```bash
npm i
node fetch.mjs --profile <浏览器配置目录> --login            # 首次：开窗口人工扫码登录（登录态存在该目录）
node fetch.mjs --profile <浏览器配置目录> --out ./dump      # 抓三册并解密，落 vol{1,2,3}_plain.json
node build.mjs --dump ./dump --out <输出目录>               # 生成底本文本 + 注解数据 + manifest
node verify.mjs --out <输出目录>                            # 校验产出（回数 / 逐回字数 / 注锚点 / sha256）
```

`build.mjs` 的 `--out` 必填：落到 `docs/` 即完成换底本，因此不做默认值，避免误覆盖语料。
`dump/` 中间产物（解密后的原始 JSON）不入库。

## 取数原理（脚本已实现，无需人工翻页）

- 正文：`POST /j/article_v2/get_reader_data`，入参仅 `aid=<册 id>`，整册一次返回
- 该数据为前端加密：AES-256-CBC，密钥 = `SHA-256(登录用户 id)`，IV = 尾部倒数第 13~29 字节，密文 = 前 len-29 字节
- 鉴权：登录 cookie（同源）+ `X-CSRF-Token` + `X-Requested-With`；每册 1 个请求，三册共 3 个

## 产出契约

- `三国演义.txt`：120 回正文，回目行 + 段落之间空行
- `sanguo-annotations.json`：注，单条 `{chapter, chapterTitle, paraIndex, offset, anchorBefore, anchorAfter, note}`
  - `paraIndex` 自 1 起，`offset` 自 0 起（段内字偏移），锚点与 chunk 方案解耦
- `front-matter.txt`：辅文（出版说明 / 修订说明 / 前言 等），不进 120 回语料
- `manifest.json`：回数 / 段落数 / 注数 / 各文件 sha256

## 边界

- 该站电子书不含插图（出版方未授权）
- 底本与注均系人民文学出版社整理成果，仅作内部语料与内部功能使用，不对外分发
