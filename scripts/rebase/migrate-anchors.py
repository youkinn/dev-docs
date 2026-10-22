#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""bug-00068 换代：派生数据锚点迁移（tags/{event,duel}.json、allusions.json）。零 LLM。

迁移规则（锚点式 1:1，不整块复制）：
- v1 块可跨段，故一个旧块对应多个新块；标签锚点取「实体可定位」的那一个新块：
  人物之生 / 人物之死 -> 含人物名（含别名）的块，死亡类优先「人名 + 死词共现」的块；
  武将单挑 -> 含双方人名的块；其余（典故表）-> 与旧块重合字数最大的块。
- 实体都不在候选块内时取重合最大块，并计入「兜底」清单（供人工抽检）。
- 多个旧键落到同一新键时合并标签文本（去重、保序）。

输入：%TEMP%\sango-rebase\chunk-map.json（relocate-ids.py 产出）
输出：改写 mcp-server/sango/data/corpus/{tags/event.json,tags/duel.json,allusions.json}（--write 时才落盘）
报告：%TEMP%\sango-rebase\migrate-report.txt
用法：py -3 scripts/rebase/migrate-anchors.py [--write]
"""
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone

MCP = os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server')
DATA = os.path.join(MCP, 'sango/data/corpus')
CORPUS = os.path.join(DATA, 'sanguo-yanyi')
OUT_DIR = os.path.join(tempfile.gettempdir(), 'sango-rebase')
MAP_PATH = os.path.join(OUT_DIR, 'chunk-map.json')
REPORT = os.path.join(OUT_DIR, 'migrate-report.txt')
WRITE = '--write' in sys.argv

# 新旧底本校订用字差异（旧 -> 新），实体形态比对前归一
# 匹配期用（只用于实体形态比对，不改语料与标签）：新旧底本校订用字 + 异体字
MATCH_VARIANTS = str.maketrans({'馀': '余', '邰': '郃', '毌': '毋', '麴': '麹', '祎': '袆', '顒': '颙', '听': '昕'})
# 实体表未收录人物的匹配用别名（仅匹配期）
EXTRA_FORMS = {
    '司马徽': ['水镜', '德操'],
    '徐庶': ['单福', '元直'],
    '姜叙母': ['叙之母', '叙母'],
}
DEATH_WORDS = re.compile('(死|杀|病|亡|故|薨|崩|殒|卒|斩|诛|剁|缢|刎|自刎|授首|遇害|杖毙)')
BIRTH_RE = re.compile(r'^人物之生-(.+)登场$')
DEATH_RE = re.compile(r'^人物之死-(.+)之死$')
DUEL_RE = re.compile(r'^武将单挑-([^-]+)-([^-]+)$')


# 人工核证覆盖（换底本迁移期锚点，依据 gap.md「L3 锚点人工核证」）：'标签文本' -> 新语料锚点段
# 仅用于机器口径与人工核证结论不一致的条目；新增须逐条给出依据。
TAG_ANCHOR_OVERRIDES = {
    # 曹睿之死：核证口径取病危段（睿执司马懿手托孤），谥/葬段不计；别名「明帝」会把机器口径带偏到谥/葬段
    '人物之死-曹睿之死': 'sanguo-yanyi:0106:p0008:c02',
}


def load_corpus():
    ids, text, order = [], {}, {}
    for h in range(1, 121):
        hui = '%03d' % h
        with open(os.path.join(CORPUS, hui + '.json'), encoding='utf-8') as fh:
            chunks = json.load(fh)['chunks']
        order[hui] = [c['chunk_id'] for c in chunks]
        for c in chunks:
            ids.append(c['chunk_id'])
            text[c['chunk_id']] = c['text']
    return ids, text, order


def hui_of(old_id):
    return '%03d' % int(old_id.split(':')[1])


def load_person_forms():
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


def forms_of(person, forms, alias2canon):
    canon = alias2canon.get(person, person)
    return forms.get(canon, {person}) | set(EXTRA_FORMS.get(person, []))


def pick(cands, order, text, need=None, prefer_death=False, window=4):
    """锚点定位：先在本旧块映射到的新块里找实体，再退到回内 ±window 邻域，最后退重合最大块。

    cands: [[cid, overlap], ...]；order: 回内块序（chunk_id 列表）；need: 人名形态集合。
    返回 (cid, 依据)；依据 ∈ {人名+死词, 人名, 邻域, 重合兜底}。
    """
    def has_forms(cid):
        t = text[cid].translate(MATCH_VARIANTS)
        return any(f.translate(MATCH_VARIANTS) in t for f in need) if need else True

    if need:
        hit = [c for c in cands if has_forms(c[0])]
        if hit:
            if prefer_death:
                hitd = [c for c in hit if DEATH_WORDS.search(text[c[0]])]
                if hitd:
                    return max(hitd, key=lambda c: c[1])[0], '人名+死词'
                return max(hit, key=lambda c: c[1])[0], '人名'
            return max(hit, key=lambda c: c[1])[0], '人名'
        idx = [order.index(c[0]) for c in cands]
        lo, hi = min(idx), max(idx)
        near = [order[i] for i in range(max(0, lo - window), min(len(order), hi + window + 1))
                if has_forms(order[i])]
        if near:
            best = min(near, key=lambda cid: min(abs(order.index(cid) - j) for j in idx))
            return best, '邻域'
    return max(cands, key=lambda c: c[1])[0], '重合兜底'


HERE = os.path.dirname(os.path.abspath(__file__))
DEV_DOCS = os.path.dirname(os.path.dirname(HERE))
SEG_TABLE_RE = re.compile(r"'(\d{4}:c\d{4})'")
L3_TABLE_RE = re.compile(r"'sanguo-yanyi:(\d{4}:c\d{4})'")


def remap_js_tables(cmap):
    """把两处 JS 常量表里的旧 chunkId 重映射到新语料（--write 时才落盘）。

    - build-events.mjs 的 SEG_OVERRIDE（人工核证的事件块组）-> 旧块映射到的全部新块
    - l3-anchor-overrides.mjs 的 L3_ANCHOR_OVERRIDES（锚点位点，后续 ±N 扩展）-> 重合最大的新块
    """
    changed = []

    p = os.path.join(DEV_DOCS, 'test/events/build-events.mjs')
    src = open(p, encoding='utf-8').read()
    head, rest = src.split('const SEG_OVERRIDE', 1)
    block, tail = rest.split('};', 1)

    def seg_sub(m):
        ids = cmap.get('sanguo-yanyi:' + m.group(1))
        if not ids:
            raise SystemExit('SEG_OVERRIDE 旧 id 无映射：' + m.group(1))
        return "'" + "', '".join(cid.split('sanguo-yanyi:')[1] for cid, _ in ids) + "'"

    def dedupe_line(line):
        m = re.match(r"^(\s*'[^']+':\s*\[)(.*)(\],?\s*)$", line)
        if not m:
            return line
        seen, out = set(), []
        for i in re.findall(r"'([^']+)'", m.group(2)):
            if i not in seen:
                seen.add(i)
                out.append(i)
        return m.group(1) + ', '.join("'%s'" % i for i in out) + m.group(3)

    block2 = '\n'.join(dedupe_line(l) for l in SEG_TABLE_RE.sub(seg_sub, block).split('\n'))
    if block2 != block:
        open(p, 'w', encoding='utf-8').write(head + 'const SEG_OVERRIDE' + block2 + '};' + tail)
        changed.append(p)

    p = os.path.join(DEV_DOCS, 'test/events/l3-anchor-overrides.mjs')
    src = open(p, encoding='utf-8').read()

    def l3_sub(m):
        ids = cmap.get('sanguo-yanyi:' + m.group(1))
        if not ids:
            raise SystemExit('L3_ANCHOR_OVERRIDES 旧 id 无映射：' + m.group(1))
        return "'" + max(ids, key=lambda c: c[1])[0] + "'"

    src2 = L3_TABLE_RE.sub(l3_sub, src)
    if src2 != src:
        open(p, 'w', encoding='utf-8').write(src2)
        changed.append(p)
    return changed


def main():
    cmap = json.load(open(MAP_PATH, encoding='utf-8'))
    ids, text, order = load_corpus()
    valid = set(ids)
    forms, alias2canon = load_person_forms()
    lines = []

    def say(s):
        print(s)
        lines.append(s)

    stats = {}

    # ---- tags/event.json（人物之生 / 人物之死）----
    ev = json.load(open(os.path.join(DATA, 'tags/event.json'), encoding='utf-8'))
    if any(':p' in k for k in ev):
        raise SystemExit('输入 tags/event.json 已是新格式（含 :p 段号），请先 git checkout 还原为旧 id 再迁移')
    out_ev, basis, fallback = {}, {}, []
    for old_id, val in ev.items():
        cands = cmap.get(old_id)
        for tag in val.split('|'):
            tag = tag.strip()
            if not tag:
                continue
            m = BIRTH_RE.match(tag) or DEATH_RE.match(tag)
            if not m:
                say('  跳过非法标签 %s => %s' % (old_id, tag))
                continue
            person = m.group(1)
            is_death = bool(DEATH_RE.match(tag))
            if not cands:
                fallback.append('%s %s 无候选新块' % (old_id, tag))
                continue
            cid, how = TAG_ANCHOR_OVERRIDES.get(tag), None
            if not cid:
                cid, how = pick(cands, order[hui_of(old_id)], text, forms_of(person, forms, alias2canon), is_death)
            out_ev.setdefault(cid, [])
            if tag not in out_ev[cid]:
                out_ev[cid].append(tag)
            basis[how] = basis.get(how, 0) + 1
            if how == '重合兜底':
                fallback.append('%s %s -> %s（候选块均无该人名）' % (old_id, tag, cid))
    low_conf = []
    for old_id, val in ev.items():
        cands = cmap.get(old_id) or []
        if not cands:
            continue
        mx = max(c[1] for c in cands)
        for tag in val.split('|'):
            owners = [k for k, v in out_ev.items() if tag in v]
            for k in owners:
                ov_ = dict((c[0], c[1]) for c in cands).get(k, 0)
                if ov_ < 0.5 * mx:
                    low_conf.append('%s %s -> %s 重合%d/%d' % (old_id, tag, k, ov_, mx))
    stats['event.json'] = (len(ev), sum(len(v.split('|')) for v in ev.values()), len(out_ev),
                           sum(len(v) for v in out_ev.values()), basis)

    # ---- tags/duel.json（武将单挑）----
    duel = json.load(open(os.path.join(DATA, 'tags/duel.json'), encoding='utf-8'))
    out_duel, dbasis, dfb = {}, {}, []
    for old_id, val in duel.items():
        cands = cmap.get(old_id)
        for tag in val.split('|'):
            tag = tag.strip()
            if not tag:
                continue
            m = DUEL_RE.match(tag)
            if not m:
                say('  跳过非法单挑标签 %s => %s' % (old_id, tag))
                continue
            if not cands:
                dfb.append('%s %s 无候选新块' % (old_id, tag))
                continue
            need = set()
            for n in (m.group(1), m.group(2)):
                need |= forms_of(n, forms, alias2canon)
            cid, how = pick(cands, order[hui_of(old_id)], text, need)
            out_duel.setdefault(cid, [])
            if tag not in out_duel[cid]:
                out_duel[cid].append(tag)
            dbasis[how] = dbasis.get(how, 0) + 1
            if how == '重合兜底':
                dfb.append('%s %s -> %s' % (old_id, tag, cid))
    stats['duel.json'] = (len(duel), sum(len(v.split('|')) for v in duel.values()), len(out_duel),
                          sum(len(v) for v in out_duel.values()), dbasis)

    # ---- allusions.json（典故，按重合最大块取锚点）----
    al = json.load(open(os.path.join(DATA, 'allusions.json'), encoding='utf-8'))
    al_before = sum(len(r.get('chunkIds', [])) for r in al['rows'])
    al_dropped = []
    for r in al['rows']:
        new = []
        for cid in r.get('chunkIds', []):
            cands = cmap.get(cid)
            if not cands:
                al_dropped.append('%s %s 死键 %s' % (r['eventId'], r['eventName'], cid))
                continue
            nid = max(cands, key=lambda c: c[1])[0]
            if nid not in new:
                new.append(nid)
        r['chunkIds'] = new
    al_after = sum(len(r['chunkIds']) for r in al['rows'])
    empty_rows = [r['eventId'] for r in al['rows'] if not r['chunkIds']]

    say('== tags/event.json ==  条目 %d -> %d｜标签实例 %d -> %d｜定位依据 %s'
        % (stats['event.json'][0], stats['event.json'][2], stats['event.json'][1], stats['event.json'][3], stats['event.json'][4]))
    say('== tags/duel.json ==   条目 %d -> %d｜标签实例 %d -> %d｜定位依据 %s'
        % (stats['duel.json'][0], stats['duel.json'][2], stats['duel.json'][1], stats['duel.json'][3], stats['duel.json'][4]))
    say('== allusions.json ==   引用 %d -> %d｜空行 %d｜死键 %d' % (al_before, al_after, len(empty_rows), len(al_dropped)))
    say('兜底(生/死) %d 条；兜底(单挑) %d 条；死键 %d 条；空行 %d 条'
        % (len(fallback), len(dfb), len(al_dropped), len(empty_rows)))
    for l in fallback + dfb + al_dropped:
        lines.append('  ' + l)
    say('低置信锚点（落点重合 < 50%% 最大重合，供人工抽检）：%d 条' % len(low_conf))
    for l in low_conf:
        lines.append('  [低置信] ' + l)
    json.dump({k: '|'.join(v) for k, v in out_ev.items()}, open(os.path.join(OUT_DIR, 'tags-event.new.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=0, sort_keys=True)
    json.dump({k: '|'.join(v) for k, v in out_duel.items()}, open(os.path.join(OUT_DIR, 'tags-duel.new.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=0, sort_keys=True)

    if WRITE:
        for key in list(out_ev) + list(out_duel):
            if key not in valid:
                raise SystemExit('非法新键 %s' % key)
        json.dump({k: '|'.join(v) for k, v in out_ev.items()}, open(os.path.join(DATA, 'tags/event.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2, sort_keys=True)
        json.dump({k: '|'.join(v) for k, v in out_duel.items()}, open(os.path.join(DATA, 'tags/duel.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2, sort_keys=True)
        al['meta']['corpusChunkCount'] = len(ids)
        al['meta']['generatedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + '%03dZ' % (datetime.now(timezone.utc).microsecond // 1000)
        al['meta']['normVersion'] = hashlib.sha256(
            json.dumps(al['rows'], ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()[:8]
        json.dump(al, open(os.path.join(DATA, 'allusions.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2)
        say('已写入 tags/event.json、tags/duel.json、allusions.json（meta.normVersion=%s）' % al['meta']['normVersion'])
        for f in remap_js_tables(cmap):
            say('已重映射 JS 常量表：' + f)
    else:
        say('（干跑，未写盘；加 --write 落盘）')

    with open(REPORT, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
    print('report ->', REPORT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
