#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""低置信死亡锚点复筛：按「句内人名 + 死亡谓语」找更可信回内候选。"""
import json
import os
import re
import tempfile

MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
DATA = os.path.join(MCP, 'sango/data/corpus')
CORPUS = os.path.join(DATA, 'sanguo-yanyi')
REPORT = os.path.join(tempfile.gettempdir(), 'sango-rebase', 'migrate-report.txt')
VARIANTS = str.maketrans({'馀': '余', '邰': '郃', '毌': '毋', '麴': '麹', '祎': '袆', '顒': '颙', '听': '昕'})
EXTRA = {'姜叙母': ['叙母', '叙之母', '老母'], '伏皇后': ['伏后'], '何太后': ['太后', '何后'],
         '曹睿': ['曹叡', '睿'], '司马徽': ['水镜', '德操'], '徐庶': ['单福', '元直']}
STRONG = re.compile('(死|亡|斩|杀|诛|刺|缢|绞|砍|射|鸩|杖|刎|崩|薨|卒|殒|伏诛|枭首|首级|透咽喉|撺下楼|气绝|身死)')
DEATH_RE = re.compile(r'^人物之死-(.+)之死$')


def norm(s):
    return re.sub(r'[^0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff]', '', s).translate(VARIANTS)


def load_chapter(hui):
    path = os.path.join(CORPUS, '%03d.json' % hui)
    return json.load(open(path, encoding='utf-8'))['chunks']


def load_forms():
    table = json.load(open(os.path.join(MCP, 'sango/data/entity-table.json'), encoding='utf-8'))
    forms, alias2canon = {}, {}
    for row in table['rows']:
        if row.get('type') != '人物':
            continue
        canon = row['canonical']
        fs = {canon, *row.get('aliases', []), *row.get('rewriteKeys', [])}
        forms[canon] = fs
        for w in fs:
            alias2canon[w] = canon
    return forms, alias2canon


def forms_of(name, forms, alias2canon):
    canon = alias2canon.get(name, name)
    return forms.get(canon, {name}) | set(EXTRA.get(name, []))


def score_chunk(text, fs):
    best, hit = 0, ''
    for sent in re.split(r'(?<=[。！？；])', text):
        if not any(norm(f) in norm(sent) for f in fs):
            continue
        if STRONG.search(sent):
            s = 3
            for f in fs:
                i = norm(sent).find(norm(f))
                if i >= 0 and STRONG.search(norm(sent)[i:i + len(norm(f)) + 20]):
                    s = 4
                    break
            if s > best:
                best, hit = s, sent
    return best, hit


def main():
    forms, alias2canon = load_forms()
    lines = open(REPORT, encoding='utf-8').read().splitlines()
    for line in lines:
        m = re.match(r'\s*\[低置信\] (sanguo-yanyi:\d{4}:c\d{4}) (.+?) -> (sanguo-yanyi:\d{4}:p\d{4}:c\d{2}).*', line)
        if not m:
            continue
        old, tag, current = m.groups()
        dm = DEATH_RE.match(tag)
        if not dm:
            continue
        hui = int(old.split(':')[1])
        fs = forms_of(dm.group(1), forms, alias2canon)
        scored = []
        for c in load_chapter(hui):
            sc, sent = score_chunk(c['text'], fs)
            if sc:
                scored.append((sc, c['chunk_id'], sent))
        scored.sort(key=lambda x: (-x[0], x[1]))
        best = scored[0] if scored else (0, '', '')
        if best[1] != current:
            print('%s | %s' % (tag, old))
            print('  current %s :: %s' % (current, next((c['text'] for c in load_chapter(hui) if c['chunk_id'] == current), '')[:120]))
            print('  suggest %s (%d) :: %s' % (best[1], best[0], best[2]))
            for sc, cid, sent in scored[1:4]:
                print('  alt     %s (%d) :: %s' % (cid, sc, sent))


if __name__ == '__main__':
    main()
