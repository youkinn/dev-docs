/**
 * feat-A015 回归验证脚本（薄壳版，story-A015-02 收敛）
 *
 * story-A015-02 起，判定逻辑收敛到 mcp-server sango/src/benchmark/ 单模块（契约见
 * docs/feat-A015-benchmark-api.md §1：判定逻辑只存一份，禁止两份实现漂移）。本脚本不再
 * 内嵌解析 / 匹配 / 判定，改为调用 sango 本地 dev 接口 POST /dev/benchmark/run
 * （与页面「执行」同一入口），快照由服务端落盘。
 *
 * 前置：先启动 sango dev 服务（加载语料 + 向量约 12 秒）：
 *   cd D:\workplace\mcp-server\sango && npm run dev
 *   （等价手写：npm run build; $env:SANGO_DEV_HTTP_PORT = "8787"; node dist/index.js）
 *
 * 用法（同旧版）：
 *   cd D:\workplace\dev-docs
 *   node --experimental-strip-types test/standard-set/feat-A015-verify.mjs
 *
 * 输出：类别汇总表（与 summary.md「十三段模板 COPY」同口径）；本次快照
 *       test/standard-set/results/feat-A015-YYYY-MM-DD-HHMM.{json,-summary.md}。
 */
const DEFAULT_PORT = 8787;

/** summary.md 类别显示名：官职 → 官职/爵位（与评测集「十三」表同口径）。 */
const CATEGORY_LABEL = {
  人物: '人物',
  地名: '地名',
  战役: '战役',
  典故: '典故',
  器物: '器物',
  身体部位: '身体部位',
  官职: '官职/爵位',
  数字称谓: '数字称谓',
  事件关系: '事件关系',
  死亡: '死亡',
  拒答: '拒答',
};

async function main() {
  const port = process.env.SANGO_DEV_HTTP_PORT || String(DEFAULT_PORT);
  const url = `http://127.0.0.1:${port}/dev/benchmark/run`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error(`[feat-A015] 无法连接 sango dev 服务 ${url}：${err?.message ?? err}`);
    console.error('[feat-A015] 请先按文件头注释启动 dev 服务，或检查 SANGO_DEV_HTTP_PORT。');
    process.exit(1);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.code !== 200) {
    console.error(`[feat-A015] 执行失败（HTTP ${res.status}）：${body?.message ?? '未知错误'}`);
    process.exit(1);
  }
  const { runId, summary } = body.data;
  const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;
  console.log(`# FEAT-A015 回归测试结果（${runId.slice('feat-A015-'.length)}）`);
  console.log(`> 引擎 SangoIndex（向量+BM25+标签融合，limit=${summary.engine?.inferLimit ?? 50}）；零 LLM；判对 = 证据段进 top5，6–10 兜底，其余未命中。`);
  console.log('');
  console.log('| 类别 | 总题数 | 通过数(top5) | 兜底数(6–10) | 未命中数 | 通过率 |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const [cat, v] of Object.entries(summary.category)) {
    console.log(`| ${CATEGORY_LABEL[cat] ?? cat} | ${v.total} | ${v.top5} | ${v.tail} | ${v.miss} | ${pct(v.top5, v.total)} |`);
  }
  console.log(`| **合计** | **${summary.total}** | **${summary.top5}** | **${summary.tail}** | **${summary.miss}** | **${pct(summary.top5, summary.total)}** |`);
  console.log('');
  console.log(`快照：test/standard-set/results/${runId}.json（服务端已落盘）`);
}

main().catch((err) => {
  console.error('[feat-A015]', err);
  process.exit(1);
});
