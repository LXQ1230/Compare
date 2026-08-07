# -*- coding: utf-8 -*-
"""模拟：用去标点+空白哈希做段落 LCS 后，最终 diff stats 的变化。"""
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

# ── 当前方案 stats（原文哈希 LCS）──
t0 = time.time()
segs_orig, stats_orig = de.diff_texts_with_style(A, B)
t1 = time.time()
print(f"=== 当前方案（原文哈希 LCS）===")
print(f"耗时: {t1-t0:.2f}s")
print(f"stats: {stats_orig}")
print()

# ── 模拟方案（去标点+空白哈希 LCS）──
def strip_all(s):
    return "".join(c for c in s if c not in de._PUNCT_CHARS
                  and c not in de._WS_CHARS and c != de._SEP)

pa = de._split_keep(A, de._SEP)
pb = de._split_keep(B, de._SEP)
n, m = len(pa), len(pb)

# 双哈希：原文哈希 + 归一化哈希
ha_orig = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb_orig = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
ha_norm = [hashlib.md5(strip_all(p).encode("utf-8")).hexdigest() for p in pa]
hb_norm = [hashlib.md5(strip_all(p).encode("utf-8")).hexdigest() for p in pb]

# 用归一化哈希做 LCS（但 eq 判定用任一哈希相同即可）
dp = [[0]*(m+1) for _ in range(n+1)]
for i in range(n):
    hn = ha_norm[i]
    ho = ha_orig[i]
    row = dp[i]
    nrow = dp[i+1]
    for j in range(m):
        # eq 条件：原文哈希相同 OR 归一化哈希相同
        if hn == hb_norm[j] or ho == hb_orig[j]:
            nrow[j+1] = row[j] + 1
        else:
            nrow[j+1] = max(row[j+1], nrow[j])

align = []
i, j = n, m
while i > 0 and j > 0:
    if ha_norm[i-1] == hb_norm[j-1] or ha_orig[i-1] == hb_orig[j-1]:
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
print(f"=== 模拟方案（归一化哈希 LCS）===")
print(f"LCS 对齐: {dict(opc)}")

# 组装替换组 → fine/coarse 分类 → 最终 stats
dmp = diff_match_patch()
dmp.Diff_Timeout = 30
raw_parts = []
del_buf, add_buf = [], []

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
        raw_parts.append((0, pa[item[1]]))
    elif item[0] == "del":
        del_buf.append(pa[item[1]])
    else:
        add_buf.append(pb[item[1]])
flush()

raw_diffs = de._merge_adjacent(raw_parts)

# 重建校验
rebuilt_a = "".join(t for op, t in raw_diffs if op in (0, -1))
rebuilt_b = "".join(t for op, t in raw_diffs if op in (0, 1))
print(f"A 重建校验: {'PASS' if rebuilt_a == A else 'FAIL'}")
print(f"B 重建校验: {'PASS' if rebuilt_b == B else 'FAIL'}")

segs_new, stats_new, _ = de._build_segments(raw_diffs)
print(f"stats: {stats_new}")
print()

# ── 对比 ──
print("=== 对比 ===")
print(f"total: {stats_orig['total']} -> {stats_new['total']} (减少 {stats_orig['total']-stats_new['total']})")
print(f"add:   {stats_orig['add']} -> {stats_new['add']} (减少 {stats_orig['add']-stats_new['add']})")
print(f"del:   {stats_orig['del']} -> {stats_new['del']} (减少 {stats_orig['del']-stats_new['del']})")
print(f"mod:   {stats_orig['mod']} -> {stats_new['mod']} (减少 {stats_orig['mod']-stats_new['mod']})")

# 替换组统计
groups_new = []
del_buf2, add_buf2 = [], []
def flush2():
    global del_buf2, add_buf2
    if del_buf2 or add_buf2:
        groups_new.append((del_buf2[:], add_buf2[:]))
        del_buf2, add_buf2 = [], []

for item in align:
    if item[0] == "eq":
        flush2()
    elif item[0] == "del":
        del_buf2.append(pa[item[1]])
    else:
        add_buf2.append(pb[item[1]])
flush2()

fine_n = coarse_n = 0
coarse_chars = 0
for db, ab in groups_new:
    d_text = "".join(db)
    a_text = "".join(ab)
    dl, al = len(d_text), len(a_text)
    if dl + al <= de._REGION_DMP_MAX or (
        len(db) == 1 and len(ab) == 1 and dl + al <= de._PAIR_DMP_MAX
    ):
        fine_n += 1
    else:
        coarse_n += 1
        coarse_chars += dl + al

print(f"\n替换组: fine={fine_n} coarse={coarse_n} (当前方案: fine=204 coarse=116)")
print(f"coarse 总字符: {coarse_chars}")
