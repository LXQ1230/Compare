# -*- coding: utf-8 -*-
"""实验：间隙对齐增强——gap 差异时做公共前缀/后缀对齐（U+2029 与标点相邻时
不再整体替换成 mod，公共部分保持 EQ）。"""
import sys, os, tempfile, shutil, hashlib
sys.path.insert(0, r"D:\Desktop\Compare")
from src_backend.parsers.idml_parser import parse_idml
import src_backend.diff_engine as de
from diff_match_patch import diff_match_patch


def align_gaps(d, a):
    """把 gap 对 (d, a) 输出为 ops：公共前缀+公共后缀保持 EQ，差异部分 DEL/ADD。"""
    if d == a:
        return [(0, d)] if d else []
    out = []
    # 公共前缀
    i = 0
    while i < len(d) and i < len(a) and d[i] == a[i]:
        i += 1
    if i:
        out.append((0, d[:i]))
    # 公共后缀（在前缀之后）
    jd, ja = len(d), len(a)
    while jd > i and ja > i and d[jd - 1] == a[ja - 1]:
        jd -= 1
        ja -= 1
    mid_d, mid_a = d[i:jd], a[i:ja]
    if mid_d:
        out.append((-1, mid_d))
    if mid_a:
        out.append((1, mid_a))
    if jd < len(d):
        out.append((0, d[jd:]))
    return out


def coarse_new(x, y):
    wx, wy = de._strip_sep(x), de._strip_sep(y)
    if not wx or wx != wy:
        return None
    # 用当前引擎的 split_by_sep（U+2029 当分隔符）
    de._coarse_punct_alignment  # noqa
    # 手动实现同构逻辑
    def split_by_sep(s):
        gaps, chars = [""], []
        for c in s:
            if c in de._PUNCT_CHARS or c in de._WS_CHARS or c == de._SEP:
                gaps[-1] += c
            else:
                chars.append(c); gaps.append("")
        return gaps, chars
    gx, cx = split_by_sep(x)
    gy, cy = split_by_sep(y)
    out = []
    eq_buf = ""
    for k in range(len(cx)):
        d, a = gx[k], gy[k]
        if d != a:
            if eq_buf:
                out.append((0, eq_buf)); eq_buf = ""
            out.extend(align_gaps(d, a))
        else:
            eq_buf += d
        eq_buf += cx[k]
    d, a = gx[len(cx)], gy[len(cy)]
    if d != a:
        if eq_buf:
            out.append((0, eq_buf)); eq_buf = ""
        out.extend(align_gaps(d, a))
    else:
        eq_buf += d
    if eq_buf:
        out.append((0, eq_buf))
    out = de._resolve_whitespace(out)
    out = de._merge_adjacent(out)
    return out


src_a = r"D:\Desktop\新建文件夹 (2)\497有图.idml"
src_b = r"D:\Desktop\新建文件夹 (2)\497导出_WD注入.idml"
tmp_a = os.path.join(tempfile.gettempdir(), "497_a.idml")
tmp_b = os.path.join(tempfile.gettempdir(), "497_b.idml")
shutil.copy2(src_a, tmp_a); shutil.copy2(src_b, tmp_b)
A = parse_idml(tmp_a).text; B = parse_idml(tmp_b).text

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
        rebuilt = coarse_new(d_text, a_text)
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
