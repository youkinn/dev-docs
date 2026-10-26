#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""bug-00068 换代：旧 chunkId -> 新语料 chunkId 重定位（回内归一化模糊对齐，零 LLM）。

用途：把换代前按旧 chunkId 键控的派生锚点（tags/*.json、events/allusions 的 chunkIds、
A015 证据片段）重定位到切分 v2 的新语料上。

输入：旧语料 = mcp-server git <REBASE_OLD_REF>:sango/data/corpus/sanguo-yanyi/*.json（v1：id/segFrom/segTo，块可跨段）
      新语料 = mcp-server 工作区同目录（v2：chunk_id/parent_id，块不跨段）
输出：%TEMP%\sango-rebase\chunk-map.json（旧 chunkId -> [[新 chunkId, 重合字符数], ...]，按出现序）
      注：v1 块可跨段，故一个旧块常对应 2~3 个新块；需按实体定位取锚点，不可整表复制。

用法：py -3 scripts/rebase/relocate-ids.py
"""
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEV_DOCS = os.path.dirname(os.path.dirname(HERE))
MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
CORPUS = os.path.join(MCP, 'sango/data/corpus/sanguo-yanyi')
TAGS_DIR = os.path.join(MCP, 'sango/data/corpus/tags')
DATA = os.path.join(MCP, 'sango/data/corpus')
OLD_REF = os.environ.get('REBASE_OLD_REF', '1b3e78d^')
OUT_DIR = os.path.join(tempfile.gettempdir(), 'sango-rebase')

# 新旧底本校订用字差异（旧 -> 新）：余/馀、张邰/张郃、毋丘俭/毌丘俭
VARIANTS = str.maketrans({'馀': '余', '邰': '郃', '毌': '毋'})
NON_CJK = re.compile(r'[^\u3400-\u4dbf\u4e00-\u9fff]')
MIN_BLOCK = 12
MIN_COVER = 0.5


def norm(text):
    return NON_CJK.sub('', text).translate(VARIANTS)


def read_old(hui):
    r = subprocess.run(['git', 'show', '%s:sango/data/corpus/sanguo-yanyi/%s.json' % (OLD_REF, hui)],
                       cwd=MCP, capture_output=True)
    if r.returncode != 0:
        raise SystemExit('git show 失败 %s: %s' % (hui, r.stderr.decode('utf-8', 'replace')[:200]))
    return json.loads(r.stdout.decode('utf-8'))


def build_map():
    chunk_map, misses, stats = {}, [], {'old': 0, 'hit': 0}
    for h in range(1, 121):
        hui = '%03d' % h
        old = read_old(hui)
        with open(os.path.join(CORPUS, hui + '.json'), encoding='utf-8') as fh:
            new = json.load(fh)
        otext, ow = '', []
        for c in old['chunks']:
            t = norm(c['text'])
            ow.append((c['id'], len(t)))
            otext += t
        ntext, nw = '', []
        for c in new['chunks']:
            t = norm(c['text'])
            nw.append((c['chunk_id'], len(t)))
            ntext += t
        blocks = [b for b in difflib.SequenceMatcher(None, otext, ntext, autojunk=False).get_matching_blocks() if b.size > 0]
        pos = 0
        for old_id, ln in ow:
            o1, o2 = pos, pos + ln
            pos = o2
            stats['old'] += 1
            acc, matched, longest = {}, 0, 0
            for b in blocks:
                if b.a >= o2 or b.a + b.size <= o1:
                    continue
                x1, x2 = max(b.a, o1), min(b.a + b.size, o2)
                matched += x2 - x1
                longest = max(longest, x2 - x1)
                j1, j2 = b.b + (x1 - b.a), b.b + (x2 - b.a)
                off = 0
                for cid, clen in nw:
                    c1, c2 = off, off + clen
                    off = c2
                    ov = min(j2, c2) - max(j1, c1)
                    if ov > 0:
                        acc[cid] = acc.get(cid, 0) + ov
            cover = matched / ln if ln else 0.0
            if longest < MIN_BLOCK or cover < MIN_COVER:
                misses.append((hui, old_id, ln, longest, round(cover, 2)))
                continue
            chunk_map[old_id] = [[cid, chars] for cid, chars in acc.items()]
            stats['hit'] += 1
    return chunk_map, misses, stats


def read_anchors():
    out = {}
    for name in ('event.json', 'duel.json'):
        p = os.path.join(TAGS_DIR, name)
        if os.path.exists(p):
            out['tags/' + name] = list(json.load(open(p, encoding='utf-8')).keys())
    for name in ('events.json', 'allusions.json'):
        refs = [cid for r in json.load(open(os.path.join(DATA, name), encoding='utf-8'))['rows']
                for cid in r.get('chunkIds', [])]
        out[name] = refs
    return out


def main():
    chunk_map, misses, stats = build_map()
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, 'chunk-map.json'), 'w', encoding='utf-8') as fh:
        json.dump(chunk_map, fh, ensure_ascii=False)
    print('旧 chunk 总数 %d｜脚本命中 %d（%.1f%%）｜待收口 %d'
          % (stats['old'], stats['hit'], 100.0 * stats['hit'] / stats['old'], len(misses)))
    dist = {}
    for v in chunk_map.values():
        dist[len(v)] = dist.get(len(v), 0) + 1
    print('旧块 -> 新块数分布', dict(sorted(dist.items())))
    print('新语料块被命中 %d / 2290' % len(set(c for v in chunk_map.values() for c, _ in v)))
    for name, refs in read_anchors().items():
        dead = [r for r in refs if r not in chunk_map]
        print('%-16s 引用 %4d｜未命中(死键) %3d' % (name, len(refs), len(dead)))
    print('--- 待收口样例（回, 旧Id, 长度, 最长块, 覆盖率）---')
    for m in misses[:20]:
        print('  %s %s len=%d longest=%d cover=%.2f' % m)
    print('map ->', os.path.join(OUT_DIR, 'chunk-map.json'))
    return 0


if __name__ == '__main__':
    sys.exit(main())