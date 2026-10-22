#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bug-00068 P2：修正事件死亡标签锚点（一次性脚本，零 LLM）。"""
import json, os, sys
P = os.path.join(os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server'), 'sango/data/corpus/tags/event.json')
MOVES = {
    '人物之死-何太后之死': ([r'sanguo-yanyi:0004:p0009:c01'], r'sanguo-yanyi:0004:p0013:c01'),
    '人物之死-姜叙母之死': ([r'sanguo-yanyi:0064:p0015:c01'], r'sanguo-yanyi:0064:p0017:c02'),
    '人物之死-伏皇后之死': ([r'sanguo-yanyi:0066:p0015:c01'], r'sanguo-yanyi:0066:p0019:c01'),
    '人物之死-李丰之死': ([r'sanguo-yanyi:0109:p0011:c02'], r'sanguo-yanyi:0109:p0013:c01'),
    '人物之死-夏侯玄之死': ([r'sanguo-yanyi:0109:p0011:c03'], r'sanguo-yanyi:0109:p0013:c01'),
    '人物之死-杨修之死': ([r'sanguo-yanyi:0072:p0008:c01', r'sanguo-yanyi:0072:p0008:c02'], r'sanguo-yanyi:0072:p0008:c03'),
    '人物之死-诸葛诞之死': ([r'sanguo-yanyi:0112:p0006:c01'], r'sanguo-yanyi:0112:p0007:c01'),
    '人物之死-田丰之死': ([r'sanguo-yanyi:0031:p0003:c01'], r'sanguo-yanyi:0031:p0002:c01'),
    '人物之死-周瑜之死': ([r'sanguo-yanyi:0057:p0007:c01'], r'sanguo-yanyi:0057:p0003:c01'),
    '人物之死-傅佥之死': ([r'sanguo-yanyi:0116:p0008:c01'], r'sanguo-yanyi:0116:p0007:c01'),
    '人物之死-关平之死': ([r'sanguo-yanyi:0077:p0003:c01'], r'sanguo-yanyi:0077:p0004:c01'),
    '人物之死-吉邈之死': ([r'sanguo-yanyi:0069:p0009:c01'], r'sanguo-yanyi:0069:p0010:c01'),
    '人物之死-吉穆之死': ([r'sanguo-yanyi:0069:p0008:c01'], r'sanguo-yanyi:0069:p0010:c01'),
}
d = json.load(open(P, encoding='utf-8'))
for label, (bads, good) in MOVES.items():
    for key in bads:
        tags = [t for t in d.get(key, '').split('|') if t and t != label]
        if tags:
            d[key] = '|'.join(tags)
        else:
            d.pop(key, None)
    if label in d.get(good, '').split('|'):
        continue
    d[good] = (d[good] + '|' + label) if good in d else label
# 全表块内去重
for key in list(d):
    tags = []
    for t in d[key].split('|'):
        if t and t not in tags:
            tags.append(t)
    d[key] = '|'.join(tags)
birth = death = 0
for v in d.values():
    for t in v.split('|'):
        if t.startswith('人物之生-'):
            birth += 1
        elif t.startswith('人物之死-'):
            death += 1
print('entries', len(d), 'birth', birth, 'death', death, 'total', birth + death)
if '--write' in sys.argv:
    with open(P, 'w', encoding='utf-8') as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2, sort_keys=True)
    print('written')
