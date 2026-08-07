# -*- coding: utf-8 -*-
"""抽样打印修复后 coarse 组的输出形态（临时脚本）。"""
import sys
import hashlib
sys.path.insert(0, r"D:\Desktop\Compare")
from src_backend.parsers.idml_parser import parse_idml
import src_backend.diff_engine as de

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


def _split(s):
    gaps = [""]
    chars = []
    for c in s:
        if c in de._PUNCT_CHARS or c in de._WS_CHARS:
            gaps[-1] += c
        else:
            chars.append(c)
            gaps.append("")
    return gaps, chars


def gap_align(x, y):
    wx, wy = de._strip_sep(x), de._strip_sep(y)
    if not wx or wx != wy:
        return None
    gx, cx = _split(x)
    gy, cy = _split(y)
    out = []
    eq_buf = ""
    for k in range(len(cx)):
        d, a = gx[k], gy[k]
        if d != a:
            if eq_buf:
                out.append((0, eq_buf))
                eq_buf = ""
            if d:
                out.append((-1, d))
            if a:
                out.append((1, a))
        else:
            eq_buf += d
        eq_buf += cx[k]
    d, a = gx[len(cx)], gy[len(cy)]
    if d != a:
        if eq_buf:
            out.append((0, eq_buf))
            eq_buf = ""
        if d:
            out.append((-1, d))
        if a:
            out.append((1, a))
    else:
        eq_buf += d
    if eq_buf:
        out.append((0, eq_buf))
    return out


shown = 0
for db, ab in groups:
    d_text = "".join(db)
    a_text = "".join(ab)
    if len(d_text) + len(a_text) <= 4096:
        continue
    rebuilt = gap_align(d_text, a_text)
    if rebuilt is None:
        continue
    rebuilt = de._resolve_whitespace(rebuilt)
    rebuilt = de._merge_adjacent(rebuilt)
    shown += 1
    if shown > 3:
        break
    print(f"=== coarse 组 #{shown} (del {len(d_text)} 字符 / add {len(a_text)} 字符, 输出 {len(rebuilt)} 段) ===")
    parts = []
    for op, t in rebuilt:
        if op == -1:
            parts.append(f"[DEL:{t!r}]")
        elif op == 1:
            parts.append(f"[ADD:{t!r}]")
        else:
            parts.append(t if len(t) < 40 else t[:40] + "...")
    print("".join(parts)[:700])
    print()
