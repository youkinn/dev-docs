#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""bug-00068 P2：迁移后锚点全量预筛（零 LLM）。

不替代人工判读：只把「锚点块不含实体 / 死亡类不含死词 / 回内有更早命中」的条目
压缩成清单，附带候选块与原文摘录，供逐条复核。

输出：%TEMP%\sango-rebase\p2-anchor-audit.txt
用法：py -3 scripts/rebase/audit-anchors.py
"""
import json
import os
import re
import tempfile

MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
DATA = os.path.join(MCP, 'sango/data/corpus')
CORPUS = os.path.join(DATA, 'sanguo-yanyi')
OUT = os.path.join(tempfile.gettempdir(), 'sango-rebase', 'p2-anchor-audit.txt')

VARIANTS = str.maketrans({'馀': '余', '邰': '郃', '毌': '毋', '麴': '麹', '祎': '袆', '顒': '颙', '听': '昕'})
EXTRA_FORMS = {'司马徽': ['水镜', '德操'], '徐庶': ['单福', '元直'], '姜叙母': ['叙之母', '叙母']}
DEATH_WORDS = re.compile('(死|杀|病|亡|故|薨|崩|殒|卒|斩|诛|剁|缢|刎|自刎|授首|遇害|杖毙)')
BIRTH_RE = re.compile(r'^人物之生-(.+)登场$')
DEATH_RE = re.compile(r'^人物之死-(.+)之死$')
NON_CJK = re.compile(r'[^0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff]')


def norm(s):
    return NON_CJK.sub('', s).translate(VARIANTS)


def load_corpus():
    chunks, chapters = {}, {}
    for hui in range(1, 121):
        with open(os.path.join(CORPUS, '%03d.json' % hui), encoding='utf-8') as fh:
            doc = json.load(fh)
        ids = []
        for c in doc['chunks']:
            chunks[c['chunk_id']] = c['text']
            ids.append(c['chunk_id'])
        chapters[hui] = ids
    return chunks, chapters


def load_forms():
    table = json.load(open(os.path.join(MCP, 'sango/data/entity-table.json'), encoding='utf-8'))
    forms, alias2canon = {}, {}
    for row in table['rows']:
        if row.get('type') != '人物':
            continue
        canon = row['canonical']
        allf = {canon, *row.get('aliases', []), *row.get('rewriteKeys', [])}
        forms[canon] = allf
        for w in allf:
            alias2canon[w] = canon
    return forms, alias2canon


def forms_of(name, forms, alias2canon):
    canon = alias2canon.get(name, name)
    return forms.get(canon, {name}) | set(EXTRA_FORMS.get(name, []))


def has_any(text, forms):
    folded = norm(text)
    return any(norm(f) in folded for f in forms)


def excerpt(text, forms=None, width=70):
    t = re.sub(r'\s+', '', text)
    if forms:
        folded = norm(t)
        for f in forms:
            i = folded.find(norm(f))
            if i >= 0:
                start = max(0, i - width // 2)
                return t[start:start + width]
    return t[:width]


def chapter_of(chunk_id):
    return int(chunk_id.split(':')[1])


def audit_events(chunks, chapters, forms, alias2canon, out):
    tags = json.load(open(os.path.join(DATA, 'tags/event.json'), encoding='utf-8'))
    counts = {'entries': len(tags), 'birth': 0, 'death': 0,
              'birth_no_form': 0, 'death_no_form': 0, 'death_no_word': 0,
              'birth_not_first': 0, 'death_not_first': 0}
    for key, value in sorted(tags.items()):
        hui = chapter_of(key)
        for tag in value.split('|'):
            m = BIRTH_RE.match(tag) or DEATH_RE.match(tag)
            if not m:
                out.append('EV|BAD_TAG|%s|%s|' % (key, tag))
                continue
            name = m.group(1)
            is_death = bool(DEATH_RE.match(tag))
            counts['death' if is_death else 'birth'] += 1
            fs = forms_of(name, forms, alias2canon)
            anchor_ok = has_any(chunks[key], fs)
            word_ok = bool(DEATH_WORDS.search(chunks[key]))
            hits = [cid for cid in chapters[hui] if has_any(chunks[cid], fs)]
            death_hits = [cid for cid in chapters[hui] if has_any(chunks[cid], fs) and DEATH_WORDS.search(chunks[cid])]
            flags = []
            if not anchor_ok:
                counts['death_no_form' if is_death else 'birth_no_form'] += 1
                flags.append('NO_FORM')
            if is_death and not word_ok:
                counts['death_no_word'] += 1
                flags.append('NO_DEATH_WORD')
            if is_death:
                preferred = death_hits or hits
                if preferred and preferred[0] != key:
                    counts['death_not_first'] += 1
                    flags.append('NOT_FIRST')
            elif hits and hits[0] != key:
                counts['birth_not_first'] += 1
                flags.append('NOT_FIRST')
            if flags:
                target = (death_hits or hits or [''])[0]
                out.append('EV|%s|%s|%s|%s|%s|%s' % (
                    '+'.join(flags), key, tag, target, excerpt(chunks[key]), excerpt(chunks[target], fs) if target else ''))
    return counts


def audit_allusions(chunks, chapters, out):
    doc = json.load(open(os.path.join(DATA, 'allusions.json'), encoding='utf-8'))
    counts = {'rows': len(doc['rows']), 'refs': 0, 'dead': 0, 'no_literal': 0, 'mixed_chapter': 0}
    for row in doc['rows']:
        refs = row.get('chunkIds', [])
        counts['refs'] += len(refs)
        names = [row['eventName'], *row.get('aliases', [])]
        hui_set = set()
        for cid in refs:
            if cid not in chunks:
                counts['dead'] += 1
                out.append('AL|DEAD|%s|%s|%s||||' % (row['eventId'], row['eventName'], cid))
                continue
            hui = chapter_of(cid)
            hui_set.add(hui)
            if not has_any(chunks[cid], names):
                counts['no_literal'] += 1
                cands = [x for x in chapters[hui] if has_any(chunks[x], names)]
                target = cands[0] if cands else ''
                out.append('AL|NO_LITERAL|%s|%s|%s|%s|%s|%s' % (
                    row['eventId'], row['eventName'], cid, target, excerpt(chunks[cid]),
                    excerpt(chunks[target], names) if target else ''))
        if len(hui_set) > 1:
            counts['mixed_chapter'] += 1
            out.append('AL|MIXED_CHAPTER|%s|%s|%s|||' % (row['eventId'], row['eventName'], ','.join(refs)))
    return counts


def main():
    chunks, chapters = load_corpus()
    forms, alias2canon = load_forms()
    out = []
    ev = audit_events(chunks, chapters, forms, alias2canon, out)
    al = audit_allusions(chunks, chapters, out)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('== event.json ==\n')
        fh.write(json.dumps(ev, ensure_ascii=False, sort_keys=True) + '\n')
        fh.write('== allusions.json ==\n')
        fh.write(json.dumps(al, ensure_ascii=False, sort_keys=True) + '\n')
        fh.write('== suspicious ==\n')
        fh.write('\n'.join(out) + '\n')
    print('event', json.dumps(ev, ensure_ascii=False, sort_keys=True))
    print('allusions', json.dumps(al, ensure_ascii=False, sort_keys=True))
    print('suspicious rows', len(out))
    print('report ->', OUT)


if __name__ == '__main__':
    main()
