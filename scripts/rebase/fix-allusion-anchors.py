#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bug-00068 P2：典故锚点补录（零 LLM）。"""
import hashlib, json, os, sys
P = os.path.join(os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server'), 'sango/data/corpus/allusions.json')
ADD = {
    'AL0044': ['sanguo-yanyi:0077:p0016:c01'],
    'AL0045': ['sanguo-yanyi:0091:p0013:c01'],
}
d = json.load(open(P, encoding='utf-8'))
for row in d['rows']:
    extra = ADD.get(row['eventId'])
    if not extra:
        continue
    ids = row['chunkIds']
    for cid in extra:
        if cid not in ids:
            ids.append(cid)
    ids.sort(key=lambda c: (int(c.split(':')[1]), c.split(':')[2], c.split(':')[3]))
    print(row['eventId'], '->', ','.join(ids))
d['meta']['normVersion'] = hashlib.sha256(
    json.dumps(d['rows'], ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()[:8]
print('normVersion', d['meta']['normVersion'])
if '--write' in sys.argv:
    with open(P, 'w', encoding='utf-8') as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2)
    print('written')

