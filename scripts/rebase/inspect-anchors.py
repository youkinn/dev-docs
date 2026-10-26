#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""bug-00068 P2：低置信标签锚点与典故锚点人工复核清单。

用法：
  py -3 scripts/rebase/inspect-anchors.py low
  py -3 scripts/rebase/inspect-anchors.py allusions
"""
import json
import os
import re
import sys
import tempfile

MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
DATA = os.path.join(MCP, 'sango/data/corpus')
CORPUS = os.path.join(DATA, 'sanguo-yanyi')
REPORT = os.path.join(tempfile.gettempdir(), 'sango-rebase', 'migrate-report.txt')
VARIANTS = str.maketrans({'馀': '余', '邰': '郃', '毌': '毋', '麴': '麹', '祎': '袆', '顒': '颙', '听': '昕'})
DEATH_WORDS = re.compile('(死|杀|病|亡|故|薨|崩|殒|卒|斩|诛|剁|缢|刎|自刎|授首|遇害|杖毙)')


def norm(s):
    return re.sub(r'[^0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff]', '', s).translate(VARIANTS)


def load_corpus():
    chunks, titles = {}, {}
    for hui in range(1, 121):
        with open(os.path.join(CORPUS, '%03d.json' % hui), encoding='utf-8') as fh:
            doc = json.load(fh)
        titles[hui] = doc['title']
        for c in doc['chunks']:
            chunks[c['chunk_id']] = c['text']
    return chunks, titles


def excerpt(text, needle=None, width=90):
    t = re.sub(r'\s+', '', text)
    if needle:
        i = norm(t).find(norm(needle))
        if i >= 0:
            s = max(0, i - width // 2)
            return t[s:s + width]
    return t[:width]


def low(chunks, titles):
    lines = open(REPORT, encoding='utf-8').read().splitlines()
    for line in lines:
        m = re.match(r'\s*\[低置信\] (sanguo-yanyi:\d{4}:c\d{4}) (.+?) -> (sanguo-yanyi:\d{4}:p\d{4}:c\d{2}).*', line)
        if not m:
            continue
        old, tag, new = m.groups()
        name = re.sub(r'^人物之[生死]-|登场$|之死$', '', tag)
        hui = int(old.split(':')[1])
        print('%s | %s | %s | %s | name=%s | death=%s' % (
            old, tag, new, titles[hui], 'Y' if norm(name) in norm(chunks.get(new, '')) else 'N',
            'Y' if DEATH_WORDS.search(chunks.get(new, '')) else 'N'))
        print('  ' + excerpt(chunks.get(new, ''), name))


def allusions(chunks, titles):
    doc = json.load(open(os.path.join(DATA, 'allusions.json'), encoding='utf-8'))
    for row in doc['rows']:
        refs = row['chunkIds']
        chapters = sorted({int(x.split(':')[1]) for x in refs})
        print('%s %s | ch=%s | refs=%d | %s' % (
            row['eventId'], row['eventName'], ','.join(map(str, chapters)), len(refs),
            ' / '.join(titles[h] for h in chapters)))
        for cid in refs:
            hit = any(norm(n) in norm(chunks[cid]) for n in [row['eventName'], *row.get('aliases', [])])
            print('  %s literal=%s %s' % (cid, 'Y' if hit else 'N', excerpt(chunks[cid], row['eventName'])))


def main():
    chunks, titles = load_corpus()
    mode = sys.argv[1] if len(sys.argv) > 1 else 'low'
    if mode == 'low':
        low(chunks, titles)
    elif mode == 'allusions':
        allusions(chunks, titles)
    else:
        raise SystemExit('mode must be low or allusions')


if __name__ == '__main__':
    main()
