#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""显示某回指定块：py -3 show-chunks.py 77 p0003 p0004"""
import json
import os
import sys

MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
CORPUS = os.path.join(MCP, 'sango/data/corpus/sanguo-yanyi')


def main():
    hui = int(sys.argv[1])
    prefixes = tuple(sys.argv[2:])
    doc = json.load(open(os.path.join(CORPUS, '%03d.json' % hui), encoding='utf-8'))
    for c in doc['chunks']:
        if not prefixes or any((':%s:' % p) in c['chunk_id'] or c['chunk_id'].endswith(':' + p) for p in prefixes):
            print(c['chunk_id'], c['text'])


if __name__ == '__main__':
    main()
