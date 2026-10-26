#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bug-00068 P2：entity-table 对 120 回新语料命中率重测（零 LLM）。
输出：%TEMP%/sango-rebase/entity-hit-audit.txt
"""
import json, os, re, tempfile
MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
CORPUS = os.path.join(MCP, 'sango/data/corpus/sanguo-yanyi')
TABLE = os.path.join(MCP, 'sango/data/entity-table.json')
OUT = os.path.join(tempfile.gettempdir(), 'sango-rebase', 'entity-hit-audit.txt')
VARIANTS = str.maketrans({'馀': '余', '邰': '郃', '毌': '毋', '麴': '麹', '祎': '袆', '顒': '颙'})
NON_CJK = re.compile(r'[^0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff]')

def norm(s):
    return NON_CJK.sub('', s).translate(VARIANTS)

def main():
    texts = []
    for hui in range(1, 121):
        doc = json.load(open(os.path.join(CORPUS, '%03d.json' % hui), encoding='utf-8'))
        texts.extend(c['text'] for c in doc['chunks'])
    raw = '\n'.join(texts)
    folded = norm(raw)
    table = json.load(open(TABLE, encoding='utf-8'))
    zero, total = [], 0
    for row in table['rows']:
        fields = [('canonical', [row['canonical']]),
                  ('aliases', row.get('aliases', [])),
                  ('rewriteKeys', row.get('rewriteKeys', []))]
        for fname, words in fields:
            for w in words:
                total += 1
                nw = norm(w)
                if not nw:
                    continue
                if nw in folded or (w in raw if w != nw else False):
                    continue
                zero.append((row['id'], row['type'], row['canonical'], fname, w))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('total words %d / zero-hit %d\n' % (total, len(zero)))
        for r in zero:
            fh.write('\t'.join(str(x) for x in r) + '\n')
    print('total words', total, 'zero-hit', len(zero))
    print('report ->', OUT)
    for r in zero[:80]:
        print('\t'.join(str(x) for x in r))

if __name__ == '__main__':
    main()

