# -*- coding: utf-8 -*-
"""方案 B 完整模拟：归一化哈希 LCS + eq 段内 diff + 重建校验分析。"""
import sys, os, tempfile, shutil, hashlib, time
from collections import Counter

sys.path.insert(0, r"D:\Desktop\Compare")
from src_backend.parsers.idml_parser import parse_idml
import src_backend.diff_engine as de
from diff_match_patch import diff_match_patch

src_a = r"D:\Desktop\新建文件夹 (2)\497有图.idml"
src_b = r"D:\Desktop\新建文件夹 (2)\497导出_WD注入.idml"
tmp_a = os.path.join(tempfile.gettempdir(), "497_a.idml")
tmp_b = os.path.join(tempfile.gettempdir(), "497_b.idml")
shutil.copy2(src_a, tmp_a)
shutil.copy2(src_b, tmp_b)

A = parse_idml(tmp_a).text
B = parse_idml(tmp_b).text

# 方案 A 修复后的 _strip_sep（剥离 U+2029）
def strip_sep_fixed(s):
    return "".join(c for c in s if c not in de._PUNCT_CHARS
                  and c not in de._WS_CHARS and c != de._SEP)

pa = de._split_keep(A, de._SEP)
pb = de._split_keep(B, de._SEP)
n, m = len(pa), len(pb)

# 原文哈希 + 归一化哈希
ha_orig = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb_orig = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
ha_norm = [hashlib.md5(strip_sep_fixed(p).encode("utf-8")).hexdigest() for p in pa]
hb_norm = [hashlib.md5(strip_sep_fixed(p).encode("utf-8")).hexdigest() for p in pb]

# 归一化哈希 LCS
t0 = time.time()
dp = [[0]*(m+1) for _ in range(n+1)]
for i in range(n):
    hn = ha_norm[i]
    row = dp[i]
    nrow = dp[i+1]
    for j in range(m):
        if hn == hb_norm[j]:
            nrow[j+1] = row[j] + 1
        else:
            nrow[j+1] = max(row[j+1], nrow[j])

align = []
i, j = n, m
while i > 0 and j > 0:
    if ha_norm[i-1] == hb_norm[j-1]:
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
print(f"归一化哈希 LCS: {dict(opc)}")

# 组装：eq 段如果原文不同 → 段内 fine DMP
dmp = diff_match_patch()
dmp.Diff_Timeout = 30
raw_parts = []
del_buf, add_buf = [], []
eq_same = eq_diff = 0
eq_diff_chars = 0

def flush():
    global del_buf, add_buf
    if not del_buf and not add_buf:
        return
    d_text = "".join(del_buf)
    a_text = "".join(add_buf)
    dl, al = len(d_text), len(a_text)
    if dl + al <= de._REGION_DMP_MAX:
        raw_parts.extend(de._diff_fine_group(dmp, d_text, a_text))
    elif len(del_buf) == 1 and len(add_buf) == 1 and dl + al <= de._PAIR_DMP_MAX:
        raw_parts.extend(de._diff_fine_group(dmp, d_text, a_text))
    else:
        rebuilt = de._coarse_punct_alignment(d_text, a_text)
        if rebuilt is not None:
            raw_parts.extend(rebuilt)
        else:
            if d_text:
                raw_parts.append((-1, d_text))
            if a_text:
                raw_parts.append((1, a_text))
    del_buf, add_buf = [], []

for item in align:
    if item[0] == "eq":
        flush()
        ai, bi = item[1], item[2]
        if ha_orig[ai] == hb_orig[bi]:
            raw_parts.append((0, pa[ai]))
            eq_same += 1
        else:
            d = de._diff_fine_group(dmp, pa[ai], pb[bi])
            raw_parts.extend(d)
            eq_diff += 1
            eq_diff_chars += len(pa[ai]) + len(pb[bi])
    elif item[0] == "del":
        del_buf.append(pa[item[1]])
    else:
        add_buf.append(pb[item[1]])
flush()

t1 = time.time()
print(f"eq 段原文相同: {eq_same}, eq 段标点不同(段内diff): {eq_diff}")
print(f"段内 diff 总字符量: {eq_diff_chars}")
print(f"耗时: {t1-t0:.2f}s")

raw_diffs = de._merge_adjacent(raw_parts)

# 重建校验
rebuilt_a = "".join(t for op, t in raw_diffs if op in (0, -1))
rebuilt_b = "".join(t for op, t in raw_diffs if op in (0, 1))
a_exact = rebuilt_a == A
b_exact = rebuilt_b == B
a_ws = de._strip_ws(rebuilt_a) == de._strip_ws(A)
print(f"A 重建校验: exact={'PASS' if a_exact else 'FAIL'} ws_only={'PASS' if a_ws else 'FAIL'}")
print(f"B 重建校验: exact={'PASS' if b_exact else 'FAIL'}")
if not a_exact:
    # 找差异
    for i in range(min(len(rebuilt_a), len(A))):
        if rebuilt_a[i] != A[i]:
            print(f"  A 差异 @ {i}: rebuilt={rebuilt_a[max(0,i-10):i+10]!r} orig={A[max(0,i-10):i+10]!r}")
            break
    if len(rebuilt_a) != len(A):
        print(f"  A 长度: rebuilt={len(rebuilt_a)} orig={len(A)}")

segs_new, stats_new, _ = de._build_segments(raw_diffs)
print(f"\n方案 B stats: {stats_new}")

# 当前方案 stats
segs_orig, stats_orig = de.diff_texts_with_style(A, B)
print(f"当前方案 stats: {stats_orig}")
print(f"变化: total {stats_orig['total']}→{stats_new['total']} ({stats_new['total']-stats_orig['total']:+d})")
