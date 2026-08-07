# -*- coding: utf-8 -*-
"""验证：去标点+空白后哈希能多匹配多少段落。"""
import sys, os, tempfile, shutil, hashlib
from collections import Counter

sys.path.insert(0, r"D:\Desktop\Compare")
from src_backend.parsers.idml_parser import parse_idml
import src_backend.diff_engine as de

src_a = r"D:\Desktop\新建文件夹 (2)\497有图.idml"
src_b = r"D:\Desktop\新建文件夹 (2)\497导出_WD注入.idml"
tmp_a = os.path.join(tempfile.gettempdir(), "497_a.idml")
tmp_b = os.path.join(tempfile.gettempdir(), "497_b.idml")
shutil.copy2(src_a, tmp_a)
shutil.copy2(src_b, tmp_b)

A = parse_idml(tmp_a).text
B = parse_idml(tmp_b).text

pa = de._split_keep(A, de._SEP)
pb = de._split_keep(B, de._SEP)
print(f"A: {len(pa)} paragraphs, B: {len(pb)} paragraphs")

# 原文哈希
ha_orig = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb_orig = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
orig_match = sum(1 for h in ha_orig if h in set(hb_orig))
print(f"原文精确匹配: {orig_match}/{len(pa)}")

# 去标点+空白后哈希
ha_norm = [hashlib.md5(de._strip_sep(p).encode("utf-8")).hexdigest() for p in pa]
hb_norm = [hashlib.md5(de._strip_sep(p).encode("utf-8")).hexdigest() for p in pb]

# 但 \u2029 不在 _strip_sep 的剥离范围内！需要也剥离它
def strip_all(s):
    """剥离标点、空白、段落分隔符。"""
    return "".join(c for c in s if c not in de._PUNCT_CHARS
                  and c not in de._WS_CHARS and c != de._SEP)

ha_norm2 = [hashlib.md5(strip_all(p).encode("utf-8")).hexdigest() for p in pa]
hb_norm2 = [hashlib.md5(strip_all(p).encode("utf-8")).hexdigest() for p in pb]

norm_match2 = sum(1 for h in ha_norm2 if h in set(hb_norm2))
print(f"去标点+空白+分隔符后匹配: {norm_match2}/{len(pa)}")
print(f"  提升: {norm_match2 - orig_match} 个段落")
print()

# 对比：strip_sep（不剥离 \u2029）
norm_match1 = sum(1 for h in ha_norm if h in set(hb_norm))
print(f"去标点+空白(含\u2029)后匹配: {norm_match1}/{len(pa)}")
print(f"  提升: {norm_match1 - orig_match} 个段落")
print()

# 统计：strip_all 后哪些段落仍不匹配
unmatched_a = [i for i, h in enumerate(ha_norm2) if h not in set(hb_norm2)]
print(f"仍不匹配的 A 段落: {len(unmatched_a)}/{len(pa)}")
if unmatched_a:
    # 检查这些段落的长度分布
    lengths = [len(pa[i]) for i in unmatched_a]
    print(f"  长度分布: min={min(lengths)} max={max(lengths)} avg={sum(lengths)//len(lengths)}")
    # 检查是否是纯标点段落
    pure_punct = sum(1 for i in unmatched_a if not strip_all(pa[i]))
    print(f"  纯标点/空白段(去标点后为空): {pure_punct}")
    # 非纯标点的未匹配段落
    content_unmatched = [i for i in unmatched_a if strip_all(pa[i])]
    print(f"  有内容但不匹配: {len(content_unmatched)}")
    if content_unmatched:
        for i in content_unmatched[:3]:
            print(f"    段落 {i}: {pa[i][:80]!r}")

# 模拟：如果用 strip_all 哈希做 LCS，对齐结果
# 简单贪心 LCS（用 strip_all 哈希）
n, m = len(pa), len(pb)
dp = [[0]*(m+1) for _ in range(n+1)]
for i in range(n):
    hi = ha_norm2[i]
    row = dp[i]
    nrow = dp[i+1]
    for j in range(m):
        nrow[j+1] = row[j]+1 if hi == hb_norm2[j] else max(row[j+1], nrow[j])

align = []
i, j = n, m
while i > 0 and j > 0:
    if ha_norm2[i-1] == hb_norm2[j-1]:
        align.append(("eq", i-1, j-1))
        i -= 1; j -= 1
    elif dp[i-1][j] > dp[i][j-1]:
        align.append(("del", i-1))
        i -= 1
    else:
        align.append(("add", j-1))
        j -= 1
while i > 0:
    align.append(("del", i-1)); i -= 1
while j > 0:
    align.append(("add", j-1)); j -= 1
align.reverse()

opc = Counter(x[0] for x in align)
print(f"\nstrip_all LCS 对齐: {dict(opc)}")
print(f"  vs 原文 LCS: eq=613, del=1027, add=1025")
