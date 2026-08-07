# -*- coding: utf-8 -*-
"""实验：只改 _strip_sep（剥离 U+2029），split_by_sep 保持旧行为（U+2029 当实词）。
对比方案 A 全改（split_by_sep 也把 U+2029 当分隔符）的 mod 差异。"""
import sys, os, tempfile, shutil, hashlib
sys.path.insert(0, r"D:\Desktop\Compare")
from src_backend.parsers.idml_parser import parse_idml
import src_backend.diff_engine as de
from diff_match_patch import diff_match_patch

src_a = r"D:\Desktop\新建文件夹 (2)\497有图.idml"
src_b = r"D:\Desktop\新建文件夹 (2)\497导出_WD注入.idml"
tmp_a = os.path.join(tempfile.gettempdir(), "497_a.idml")
tmp_b = os.path.join(tempfile.gettempdir(), "497_b.idml")
shutil.copy2(src_a, tmp_a); shutil.copy2(src_b, tmp_b)
A = parse_idml(tmp_a).text; B = parse_idml(tmp_b).text

def split_by_sep_old(s):
    gaps, chars = [""], []
    for c in s:
        if c in de._PUNCT_CHARS or c in de._WS_CHARS:
            gaps[-1] += c
        else:
            chars.append(c); gaps.append("")
    return gaps, chars

def coarse_old(x, y):
    wx, wy = de._strip_sep(x), de._strip_sep(y)  # 修复后的 _strip_sep（剥离 U+2029）
    if not wx or wx != wy:
        return None
    gx, cx = split_by_sep_old(x)
    gy, cy = split_by_sep_old(y)
    out = []
    eq_buf = ""
    for k in range(len(cx)):
        d, a = gx[k], gy[k]
        if d != a:
            if eq_buf: out.append((0, eq_buf)); eq_buf = ""
            if d: out.append((-1, d))
            if a: out.append((1, a))
        else:
            eq_buf += d
        eq_buf += cx[k]
    d, a = gx[len(cx)], gy[len(cy)]
    if d != a:
        if eq_buf: out.append((0, eq_buf)); eq_buf = ""
        if d: out.append((-1, d))
        if a: out.append((1, a))
    else:
        eq_buf += d
    if eq_buf: out.append((0, eq_buf))
    out = de._resolve_whitespace(out)
    out = de._merge_adjacent(out)
    return out

pa = de._split_keep(A, de._SEP); pb = de._split_keep(B, de._SEP)
ha = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
n, m = len(pa), len(pb)
dp = [[0]*(m+1) for _ in range(n+1)]
for i in range(n):
    hi = ha[i]; row = dp[i]; nrow = dp[i+1]
    for j in range(m):
        nrow[j+1] = row[j]+1 if hi == hb[j] else max(row[j+1], nrow[j])
align = []
i, j = n, m
while i > 0 and j > 0:
    if ha[i-1] == hb[j-1]: align.append(("eq", i-1, j-1)); i -= 1; j -= 1
    elif dp[i-1][j] > dp[i][j-1]: align.append(("del", i-1)); i -= 1
    else: align.append(("add", j-1)); j -= 1
while i > 0: align.append(("del", i-1)); i -= 1
while j > 0: align.append(("add", j-1)); j -= 1
align.reverse()

dmp = diff_match_patch(); dmp.Diff_Timeout = 30
raw_parts = []
del_buf, add_buf = [], []
coarse_ok = coarse_fail = 0
def flush():
    global del_buf, add_buf, coarse_ok, coarse_fail
    if not del_buf and not add_buf: return
    d_text = "".join(del_buf); a_text = "".join(add_buf)
    dl, al = len(d_text), len(a_text)
    if (dl+al) <= de._REGION_DMP_MAX or (len(del_buf)==1 and len(add_buf)==1 and (dl+al) <= de._PAIR_DMP_MAX):
        d = dmp.diff_main(d_text, a_text); dmp.diff_cleanupSemantic(d)
        d = de._resolve_punct_transposition(d); d = de._resolve_punct_substring(d)
        d = de._resolve_punct_alignment(d); d = de._resolve_whitespace(d)
        raw_parts.extend(d)
    else:
        rebuilt = coarse_old(d_text, a_text)
        if rebuilt is not None:
            coarse_ok += 1
            raw_parts.extend(rebuilt)
        else:
            coarse_fail += 1
            if d_text: raw_parts.append((-1, d_text))
            if a_text: raw_parts.append((1, a_text))
    del_buf = []; add_buf = []
for item in align:
    if item[0] == "eq":
        flush(); raw_parts.append((0, pa[item[1]]))
    elif item[0] == "del": del_buf.append(pa[item[1]])
    else: add_buf.append(pb[item[1]])
flush()
raw_diffs = de._merge_adjacent(raw_parts)
rebuilt_a = "".join(t for op, t in raw_diffs if op in (0, -1))
rebuilt_b = "".join(t for op, t in raw_diffs if op in (0, 1))
print(f"重建校验: A(ws)={'PASS' if de._strip_ws(rebuilt_a)==de._strip_ws(A) else 'FAIL'} B={'PASS' if rebuilt_b==B else 'FAIL'}")
print(f"coarse 归因成功={coarse_ok} 失败={coarse_fail}")
segments, stats, _ = de._build_segments(raw_diffs)
print(f"stats: {stats}")
