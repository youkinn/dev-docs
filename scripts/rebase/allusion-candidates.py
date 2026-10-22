#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""典故锚点候选核对：同回内找含典故名 / 别名原文的块，和现锚点对照。"""
import json
import os
import re

MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
DATA = os.path.join(MCP, 'sango/data/corpus')
CORPUS = os.path.join(DATA, 'sanguo-yanyi')
VARIANTS = str.maketrans({'馀': '余', '邰': '郃', '毌': '毋', '麴': '麹', '祎': '袆', '顒': '颙', '听': '昕'})


def norm(s):
    return re.sub(r'[^0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff]', '', s).translate(VARIANTS)


def main():
    doc = json.load(open(os.path.join(DATA, 'allusions.json'), encoding='utf-8') )
    chapters = {}
    for hui in range(1, 121):
        chapters[hui] = json.load(open(os.path.join(CORPUS, '%03d.json' % hui), encoding='utf-8'))['chunks']
    for row in doc['rows']:
        names = [row['eventName'], *row.get('aliases', [])]
        refs = row['chunkIds']
        hui_set = sorted({int(x.split(':')[1]) for x in refs})
        cands = []
        for hui in hui_set:
            for c in chapters[hui]:
                if any(norm(n) in norm(c['text']) for n in names):
                    cands.append(c['chunk_id'])
        lit = [x for x in refs if x in cands]
        missing = [x for x in refs if x not in cands]
        extra = [x for x in cands if x not in refs]
        print('%s %s | refs=%s | literal=%s | missing=%s | extra=%s' % (
            row['eventId'], row['eventName'], ','.join(refs), ','.join(lit) or '-',
            ','.join(missing) or '-', ','.join(extra) or '-'))
        if cands:
            for cid in cands:
                text = next(c['text'] for hui in hui_set for c in chapters[hui] if c['chunk_id'] == cid)
                print('  cand %s :: %s' % (cid, text[:100]))


if __name__ == '__main__':
    main()
