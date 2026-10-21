#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""A015 主标准集「十、出场」「十一、死亡」两类生成（bug-00068 换代，零 LLM）。

花名册 = `sango/data/corpus/tags/event.json`（回内迁移后的标签）：
`人物之生-X登场` -> 出场类 1 题；`人物之死-X之死` -> 死亡类 1 题。
标准答案 = 标签锚点所在回；证据 = 锚点块原文片段（含实体名，死亡类优先「人名 + 死词」共现句），
片段取自原文连续子串，保证判分锚（归一化子串匹配、限定回号）命中锚点块本身。
同一人物多处标签只取最早锚点；锚点块内找不到实体形态的条目不进基准，单列「待收口」。
基准表每类按题序取前 KEEP_PER_CATEGORY 题（题序已按回号排序）；
其余题目写入 `outcome-reserve.json` 作后续备选题库。

用法：py -3 test/standard-set/gen-outcome-questions.py [--write]
--write：改写 docs/sango-rag-regression-benchmark_v0.1.md 两节内容与头部题量，并落备选题库；终端只打统计。
"""
import io
import json
import os
import re
import sys

DOC = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                   'docs', 'sango-rag-regression-benchmark_v0.1.md')
MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
CORPUS = os.path.join(MCP, 'sango/data/corpus/sanguo-yanyi')
TAGS = os.path.join(MCP, 'sango/data/corpus/tags/event.json')
ENTITY_TABLE = os.path.join(MCP, 'sango/data/entity-table.json')
WRITE = '--write' in sys.argv

# 新旧底本校订用字 + 异体字折叠（与 test/rebase/migrate-anchors.py 同口径，仅匹配期用）
MATCH_VARIANTS = str.maketrans({'馀': '余', '邰': '郃', '毌': '毋', '麴': '麹', '祎': '袆', '顒': '颙', '听': '昕'})
EXTRA_FORMS = {'司马徽': ['水镜', '德操'], '徐庶': ['单福', '元直'], '姜叙母': ['叙之母', '叙母']}
DEATH_WORDS = re.compile('(死|杀|病|亡|故|薨|崩|殒|卒|斩|诛|剁|缢|刎|自刎|授首|遇害|杖毙)')
BIRTH_RE = re.compile(r'^人物之生-(.+)登场$')
DEATH_RE = re.compile(r'^人物之死-(.+)之死$')
SENT_DELIM = '。！？；\n'
MAX_SNIPPET = 34
MIN_SNIPPET = 12

BIRTH_TEMPLATES = ['{x}首次登场是在哪一回', '{x}最早出现在哪一回', '{x}初次出场是在哪一回']
DEATH_TEMPLATES = ['{x}死在哪一回', '{x}在哪一回身亡', '{x}之死见于哪一回']

CATEGORIES = ['人物', '地名', '战役', '典故', '器物', '身体部位', '问法归一', '官职', '数字称谓', '事件关系', '出场', '死亡']

# 基准表每类保留题数；其余进备选题库（负责人 2026-10-21 定）
KEEP_PER_CATEGORY = 30
RESERVE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'outcome-reserve.json')


def load_corpus():
    chunks = {}
    for hui in range(1, 121):
        path = os.path.join(CORPUS, '%03d.json' % hui)
        with io.open(path, encoding='utf-8') as fh:
            data = json.load(fh)
        for seq, c in enumerate(data['chunks']):
            chunks[c['chunk_id']] = {'hui': hui, 'seq': seq, 'text': c['text']}
    return chunks


def load_person_forms():
    table = json.load(io.open(ENTITY_TABLE, encoding='utf-8'))
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


def forms_of(person, forms, alias2canon):
    canon = alias2canon.get(person, person)
    return forms.get(canon, {person}) | set(EXTRA_FORMS.get(person, []))


def dequote(s):
    """去引号（判分锚 norm 亦去引号，故去引号不影响锚命中）。"""
    return ''.join(ch for ch in s if ch not in '“”‘’「」『』"')


def snippet_of(text, forms, prefer_death):
    """取锚点块内原文片段：优先「实体名 + 死词」句（死亡类），退实体名句。返回 (片段, 依据)。"""
    folded = text.translate(MATCH_VARIANTS)
    needles = [f.translate(MATCH_VARIANTS) for f in forms]
    spans = []
    start = 0
    for m in re.finditer('[%s]' % SENT_DELIM, text):
        spans.append((start, m.start()))
        start = m.end()
    spans.append((start, len(text)))
    best = None
    for s, e in spans:
        seg = folded[s:e]
        hit = -1
        for n in needles:
            idx = seg.find(n)
            if idx >= 0:
                hit = idx
                break
        has_death = bool(DEATH_WORDS.search(seg))
        if hit < 0:
            score = 1 if (prefer_death and has_death) else 0
        else:
            score = 3 if (prefer_death and has_death) else 2
        if score and (best is None or score > best[0]):
            best = (score, (s, e), hit)
    if best is None:
        return None, None
    score, (s, e), hit = best
    how = {3: '人名+死词', 2: '人名', 1: '死词'}[score]
    if hit >= 0 and (e - s) > MAX_SNIPPET:
        a = max(s, s + hit - 8)
        b = min(e, a + MAX_SNIPPET)
        a = max(s, b - MAX_SNIPPET)
        s, e = a, b
    snip = text[s:e]
    # 裁到句读边界：去掉首尾半句（保证片段仍是原文连续子串，且长度 >= MIN_SNIPPET）
    for i, ch in enumerate(snip[:12]):
        if ch in '，。；：！？' and len(snip) - i - 1 >= MIN_SNIPPET and any(n in snip[i + 1:] for n in needles):
            snip = snip[i + 1:]
            break
    cut = -1
    for i, ch in enumerate(snip):
        if ch in '，。；：！？' and i >= MIN_SNIPPET and any(n in snip[:i] for n in needles):
            cut = i
    if cut > 0 and len(snip) - cut > 1:
        snip = snip[:cut]
    for ch in '“”‘’「」『』"':
        snip = snip.replace(ch, '')
    return snip.strip(' \t\r\n，。、；：！？'), how


def collect(tags, chunks):
    """标签 -> 人物最早锚点：{(kind, name): (hui, seq, chunk_id)}；返回 (锚点表, 异常标签)。"""
    anchors, bad_labels = {}, []
    for cid, labelstr in tags.items():
        hui = int(cid.split(':')[1])
        for lab in labelstr.split('|'):
            m = BIRTH_RE.match(lab)
            kind = 'birth'
            if not m:
                m = DEATH_RE.match(lab)
                kind = 'death'
            if not m:
                bad_labels.append(lab)
                continue
            name = m.group(1).strip()
            key = (kind, name)
            cur = anchors.get(key)
            if cur is None or (hui, chunks[cid]['seq']) < (cur[0], cur[1]):
                anchors[key] = (hui, chunks[cid]['seq'], cid)
    return anchors, bad_labels


def build_rows(kind, anchors, chunks, forms, alias2canon, templates):
    rows, pending = [], []
    keys = sorted([k for k in anchors if k[0] == kind],
                  key=lambda k: (anchors[k][0], anchors[k][1], k[1]))
    for _, name in keys:
        hui, seq, cid = anchors[(kind, name)]
        text = chunks[cid]['text']
        snip, how = snippet_of(text, forms_of(name, forms, alias2canon), prefer_death=(kind == 'death'))
        if snip is None or snip not in dequote(text):
            pending.append((name, cid, hui))
            continue
        num = len(rows) + 1
        rows.append({
            'num': num,
            'question': templates[(num - 1) % len(templates)].format(x=name),
            'answer': '第%d回' % hui,
            'evidence': '第%d回：“%s”' % (hui, snip),
            'name': name,
            'chunk_id': cid,
            'how': how,
        })
    return rows, pending


def render(rows):
    out = ['| # | 问题 | 标准答案 | 证据 |', '|---|---|---|---|']
    for r in rows:
        out.append('| %d | %s | %s | %s |' % (r['num'], r['question'], r['answer'], r['evidence']))
    return out


def sample_rows(rows, keep):
    """按题序取前 keep 条（题序已按回号排序），返回（保留, 备选）。"""
    return rows[:keep], rows[keep:]


def renumber(rows, templates):
    """按保留集重排 # 与问法模板（模板轮换保持均衡）。"""
    for i, r in enumerate(rows, 1):
        r['num'] = i
        r['question'] = templates[(i - 1) % len(templates)].format(x=r['name'])


def write_reserve(birth_rest, death_rest):
    fields = ('num', 'question', 'answer', 'evidence', 'name', 'chunk_id', 'how')
    data = {
        'description': 'A015 主标准集「出场 / 死亡」备选题库：基准表每类保留 %d 题，其余题目在此留存。'
                       % KEEP_PER_CATEGORY,
        'source': 'mcp-server/sango/data/corpus/tags/event.json',
        'birth': [{k: r[k] for k in fields} for r in birth_rest],
        'death': [{k: r[k] for k in fields} for r in death_rest],
    }
    with io.open(RESERVE, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write('\n')


def count_doc_items(lines):
    """按解析器口径数题：## 小节 + `| 数字 |` 行，小节标题须命中固定类别前缀。"""
    total, per, cur = 0, {}, None
    for line in lines:
        sec = re.match(r'^##\s+(.+)$', line)
        if sec:
            raw = re.sub(r'^[一二三四五六七八九十]+、?\s*', '', sec.group(1)).strip()
            cur = next((c for c in CATEGORIES if raw.startswith(c)), None)
            continue
        if not line.startswith('|') or cur is None:
            continue
        cells = [c.strip() for c in line.split('|')]
        if len(cells) >= 3 and re.match(r'^\d+$', cells[1]):
            total += 1
            per[cur] = per.get(cur, 0) + 1
    return total, per


def main():
    chunks = load_corpus()
    tags = json.load(io.open(TAGS, encoding='utf-8'))
    forms, alias2canon = load_person_forms()
    anchors, bad_labels = collect(tags, chunks)
    birth_all, birth_pending = build_rows('birth', anchors, chunks, forms, alias2canon, BIRTH_TEMPLATES)
    death_all, death_pending = build_rows('death', anchors, chunks, forms, alias2canon, DEATH_TEMPLATES)
    bad = [r for r in birth_all + death_all
           if not re.match(r'^第\d+回：“[^”]+”$', r['evidence']) or '|' in r['evidence']]
    birth_rows, birth_rest = sample_rows(birth_all, KEEP_PER_CATEGORY)
    death_rows, death_rest = sample_rows(death_all, KEEP_PER_CATEGORY)
    renumber(birth_rows, BIRTH_TEMPLATES)
    renumber(death_rows, DEATH_TEMPLATES)
    print('标签键 %d｜人物之生 %d / 人物之死 %d｜异常标签 %d'
          % (len(tags), len(birth_all), len(death_all), len(bad_labels)))
    print('基准保留 出场 %d / 死亡 %d（每类抽 %d）｜备选 出场 %d / 死亡 %d｜证据格式异常 %d'
          % (len(birth_rows), len(death_rows), KEEP_PER_CATEGORY, len(birth_rest), len(death_rest), len(bad)))
    print('待收口（锚点块内无实体形态）出场 %d / 死亡 %d' % (len(birth_pending), len(death_pending)))
    for name, cid, hui in (birth_pending + death_pending)[:40]:
        print('  [待收口] %s @ %s（第%d回）' % (name, cid, hui))
    if bad_labels:
        print('  异常标签样例：%s' % bad_labels[:5])
    if not WRITE:
        print('（未落盘；加 --write 改写 %s）' % DOC)
        return 0 if not bad else 1
    with io.open(DOC, encoding='utf-8') as fh:
        lines = fh.read().split('\n')
    i10 = next(i for i, l in enumerate(lines) if l.startswith('## 十、出场'))
    i12 = next(i for i, l in enumerate(lines) if l.startswith('## 十二'))
    block = (['## 十、出场', ''] + render(birth_rows) + ['']
             + ['## 十一、死亡', ''] + render(death_rows) + [''])
    lines[i10:i12] = block
    total, per = count_doc_items(lines)
    head = next(i for i, l in enumerate(lines) if l.startswith('> **总题量**'))
    lines[head] = re.sub(r'：\d+ 题', '：%d 题' % total, lines[head])
    note = ('> **全量类口径（出场 / 死亡）**：标签全量登场 %d 人 / 死亡 %d 人；基准表每类按题序保留前 %d 题（题序按回号排序），'
            '其余 %d / %d 题移入 `test/standard-set/outcome-reserve.json` 作后续备选。'
            '标准答案 = 标签锚点所在回，证据 = 锚点块原文片段（死亡类优先「人名 + 死词」共现句）。'
            % (len(birth_all), len(death_all), KEEP_PER_CATEGORY, len(birth_rest), len(death_rest)))
    if any(l.startswith('> **全量类口径') for l in lines):
        lines[next(i for i, l in enumerate(lines) if l.startswith('> **全量类口径'))] = note
    else:
        lines.insert(next(i for i, l in enumerate(lines) if l.startswith('> **判分口径**')) + 1, note)
    with io.open(DOC, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines))
    write_reserve(birth_rest, death_rest)
    print('备选题库 -> %s' % RESERVE)
    print('落盘 %s｜题量 %d（%s）' % (DOC, total, ' / '.join('%s=%d' % kv for kv in per.items())))
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
