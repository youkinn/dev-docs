#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, os
DATA = os.path.join(os.environ.get('MCP_SERVER_ROOT', r'D:\workplace\mcp-server'), 'sango/data/corpus')
tags = json.load(open(os.path.join(DATA, 'tags/event.json'), encoding='utf-8'))
labels = ['何太后之死','姜叙母之死','伏皇后之死','李丰之死','夏侯玄之死','杨修之死','诸葛诞之死','田丰之死','周瑜之死','傅佥之死','关平之死','吉邈之死','吉穆之死','董卓之死','王双之死']
for label in labels:
    print('==', label)
    for key, value in sorted(tags.items()):
        for tag in value.split('|'):
            if tag == '人物之死-' + label:
                print('  ', key, '|', value)
