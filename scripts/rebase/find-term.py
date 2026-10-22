#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按关键词定位新语料块：py -3 find-term.py 关键词 回号 [回号...]"""
import json
import os
import sys

MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
CORPUS = os.path.join(MCP, 'sango/data/corpus/sanguo-yanyi')


def main():
    term = sys.argv[1]
    for raw in sys.argv[2:]:
        hui = int(raw)
        path = os.path.join(CORPUS, '%03d.json' % hui)
        doc = json.load(open(path, encoding='utf-8'))
        for c in doc['chunks']:
            if term in c['text']:
                print(c['chunk_id'], c['text'])


if __name__ == '__main__':
    main()
