# -*- coding: utf-8 -*-
"""分析 497 IDML 对比中整段 DEL+ADD 的成因（临时脚本）。"""
import sys
import time
import hashlib
import difflib
from collections import Counter

sys.path.insert(0, r"D:\Desktop\Compare")
from src_backend.parsers.idml_parser import parse_idml
import src_backend.diff_engine as de
from diff_match_patch import diff_match_patch

A = parse_idml(r"C:\Users\Admin\AppData\Local\Temp\tmpe3mc_lt1.idml").text
B = parse_idml(r"C:\Users\Admin\AppData\Local\Temp\tmpm_gjpo3o.idml").text

pa = de._split_keep(A, de._SEP)
pb = de._split_keep(B, de._SEP)
ha = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
n, m = len(pa), len(pb)

dp = [[0] * (m + 1) for _ in range(n + 1)]
for i in range(n):
    hi = ha[i]
    row = dp[i]
    nrow = dp[i + 1]
    for j in range(m):
        nrow[j + 1] = row[j] + 1 if hi == hb[j] else max(row[j + 1], nrow[j])

align = []
i, j = n, m
while i > 0 and j > 0:
    if ha[i - 1] == hb[j - 1]:
        align.append(("eq", i - 1, j - 1))
        i -= 1
        j -= 1
    elif dp[i - 1][j] > dp[i][j - 1]:
        align.append(("del", i - 1))
        i -= 1
    else:
        align.append(("add", j - 1))
        j -= 1
while i > 0:
    align.append(("del", i - 1))
    i -= 1
while j > 0:
    align.append(("add", j - 1))
    j -= 1
align.reverse()

opc = Counter(x[0] for x in align)
print("LCS 对齐操作:", dict(opc))

# ── 替换组分类统计 ──
groups = []
del_buf, add_buf = [], []

def flush():
    global del_buf, add_buf
    if del_buf or add_buf:
        groups.append((del_buf[:], add_buf[:]))
        del_buf, add_buf = [], []

for item in align:
    if item[0] == "eq":
        flush()
    elif item[0] == "del":
        del_buf.append(pa[item[1]])
    else:
        add_buf.append(pb[item[1]])
flush()

dmp = diff_match_patch()
dmp.Diff_Timeout = 30
fine_groups = coarse_groups = 0
fine_del = fine_add = 0
coarse_del = coarse_add = 0
similar_but_coarse = 0
examples = []
coarse_sizes = []

for db, ab in groups:
    d_text = "".join(db)
    a_text = "".join(ab)
    dl, al = len(d_text), len(a_text)
    if dl + al <= 4096:
        fine_groups += 1
        d = dmp.diff_main(d_text, a_text)
        for op, t in d:
            if op == -1:
                fine_del += len(t)
            elif op == 1:
                fine_add += len(t)
    else:
        coarse_groups += 1
        coarse_del += dl
        coarse_add += al
        coarse_sizes.append(dl + al)
        ratio = difflib.SequenceMatcher(
            None, de._strip_sep(d_text), de._strip_sep(a_text)
        ).ratio()
        if ratio > 0.85:
            similar_but_coarse += 1
            if len(examples) < 4:
                examples.append((ratio, d_text, a_text, len(db), len(ab)))

print(f"替换组: fine(字符级)={fine_groups} 组 | coarse(段落级)={coarse_groups} 组")
print(f"fine 组内 DMP: del 字符={fine_del} add 字符={fine_add}")
print(f"coarse 组: del 字符={coarse_del} add 字符={coarse_add}")
print(f"coarse 组中实词相似度>0.85 的组数={similar_but_coarse}/{coarse_groups}")

# 验证最终 stats 与用户 autosave 一致
raw_parts = []
d2b, a2b = [], []

def flush2():
    global d2b, a2b
    if not d2b and not a2b:
        return
    d_text = "".join(d2b)
    a_text = "".join(a2b)
    dl, al = len(d_text), len(a_text)
    if dl + al <= 4096:
        raw_parts.extend(de._diff_fine_group(dmp, d_text, a_text))
    elif len(d2b) == 1 and len(a2b) == 1 and dl + al <= 2048:
        raw_parts.extend(de._diff_fine_group(dmp, d_text, a_text))
    else:
        if d_text:
            raw_parts.append((-1, d_text))
        if a_text:
            raw_parts.append((1, a_text))
    d2b, a2b = [], []

for item in align:
    if item[0] == "eq":
        flush2()
        raw_parts.append((0, pa[item[1]]))
    elif item[0] == "del":
        d2b.append(pa[item[1]])
    else:
        a2b.append(pb[item[1]])
flush2()
raw_diffs = de._merge_adjacent(raw_parts)
segs, stats, _ = de._build_segments(raw_diffs)
print("最终 stats(与 autosave 对比):", stats)

print()
print("=== coarse 组高相似示例（微小改动被整段展示）===")
for ratio, d, a, nd, na in examples:
    print(f"  ratio={ratio:.2f} del段={nd} add段={na}")
    print(f"    DEL: {d[:70]!r}")
    print(f"    ADD: {a[:70]!r}")
