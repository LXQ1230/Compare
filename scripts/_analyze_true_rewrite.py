# -*- coding: utf-8 -*-
"""深入分析 15 个真重写 coarse 组的成因。"""
import sys, os, tempfile, shutil, hashlib, difflib
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

pa = de._split_keep(A, de._SEP)
pb = de._split_keep(B, de._SEP)
ha = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
n, m = len(pa), len(pb)

dp = [[0]*(m+1) for _ in range(n+1)]
for i in range(n):
    hi = ha[i]
    row = dp[i]
    nrow = dp[i+1]
    for j in range(m):
        nrow[j+1] = row[j]+1 if hi == hb[j] else max(row[j+1], nrow[j])

align = []
i, j = n, m
while i > 0 and j > 0:
    if ha[i-1] == hb[j-1]:
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

# 收集替换组
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

print("=== 15 个真重写组的详细分析 ===\n")

idx = 0
for db, ab in groups:
    d_text = "".join(db)
    a_text = "".join(ab)
    dl, al = len(d_text), len(a_text)
    is_fine = (dl + al <= de._REGION_DMP_MAX) or (
        len(db) == 1 and len(ab) == 1 and dl + al <= de._PAIR_DMP_MAX
    )
    if is_fine:
        continue
    rebuilt = de._coarse_punct_alignment(d_text, a_text)
    if rebuilt is not None:
        continue

    idx += 1
    wx = de._strip_sep(d_text)
    wy = de._strip_sep(a_text)
    ratio = difflib.SequenceMatcher(None, wx, wy).ratio()

    # 检查 \u2029 是否是导致 _strip_sep 失败的原因
    sep_only_diff = (wx != wy) and (wx.replace("\u2029", "") == wy.replace("\u2029", ""))

    print(f"组 {idx}: ratio={ratio:.2f} del段={len(db)} add段={len(ab)} dlen={dl} alen={al}")
    print(f"  实词差异(含\\u2029): wx != wy = {wx != wy}")
    print(f"  去掉\\u2029后实词相同: {sep_only_diff}")
    if sep_only_diff:
        print(f"  *** 这是 \\u2029 未被 _strip_sep 剥离导致的误判！")
    else:
        # 分析实词差异
        sm = difflib.SequenceMatcher(None, wx, wy)
        real_diffs = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag != "equal":
                real_diffs.append(f"{tag}: '{wx[i1:i2][:30]}' -> '{wy[j1:j2][:30]}'")
        print(f"  实词差异: {real_diffs[:5]}")
    print()

print(f"\n=== 关键发现 ===")
print(f"_strip_sep 不剥离 \\u2029（段落分隔符）")
print(f"  _PUNCT_CHARS: {chr(0x2029) in de._PUNCT_CHARS}")
print(f"  _WS_CHARS: {chr(0x2029) in de._WS_CHARS}")
print(f"  _strip_sep 会保留 \\u2029 → 实词串不同 → 标点归因失败 → 整段 DEL+ADD")
