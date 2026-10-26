#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import io, os, re, sys
P = r'D:\workplace\dev-docs\docs\sango-tag-system.md'
s = open(P, encoding='utf-8').read()
reps = [
(
'| 数据 | event.json 1731（战役 766 / 政治事件 599 / 人物之死 335 / 谋略计策 203 / 结盟外交 129 / 人物之生 138 / stray「典故事件」2）；story.json 334（115 个典故名）；duel.json 39；去重 1780 / 2344 chunk | LLM 一次性批量生成、未经评审；四类事件判定主观不可信；生 / 死 / 单挑客观可验证；典故有通行名、数据质量较好 |',
'| 数据 | event.json 344 键 / 475 实例（人物之生 141 / 人物之死 334）；duel.json 35 键 / 41 实例；allusions.json 48 行 / 83 引用；语料 2290 chunk | 生 / 死 / 单挑客观可验证；典故有通行名、数据质量较好 |'
),
(
'1. **数据保留**：人物之生 / 人物之死 / 武将单挑（duel.json）/ 典故（story.json）；删除 event.json 四类（战役 / 政治事件 / 谋略计策 / 结盟外交）与 stray「典故事件」。',
'1. **数据保留**：人物之生 / 人物之死（event.json）、武将单挑（duel.json）、典故（allusions.json）；event.json 四类主观事件（战役 / 政治事件 / 谋略计策 / 结盟外交）不保留。'
),
(
'- story.json：仅典故名本体（无前缀、无解释、无句号）；通行名自带标点豁免（如「既生瑜，何生亮」）。',
'- allusions.json：一行一个典故（eventId / eventName / aliases / chunkIds / exampleQuestion）；eventName 用通行名，chunkIds 指向该典故实际叙事的语料块。'
),
(
'tagPostings 入库文本 = 人物之生 / 人物之死 → 纯人物名；duel → `A-B`（保留对阵信息）；story → 原文。',
'tagPostings 入库文本 = 人物之生 / 人物之死 → 纯人物名；duel → `A-B`（保留对阵信息）；典故走事件桥独立表，不进 tagPostings。'
),
(
'- 人工抽检：生 135 / 死 336 / 单挑 39 / 典故 334 抽样对照原文。',
'- 人工抽检：生 141 / 死 334 / 单挑 41 实例 / 典故 48 行逐条对照原文。'
),
]
for old, new in reps:
    if old not in s:
        raise SystemExit('NOT FOUND: ' + old[:60])
    s = s.replace(old, new)
s = re.sub(r'\n## 维护记录[\s\S]*\Z', '\n', s)
open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('updated', P, len(s), 'chars')
