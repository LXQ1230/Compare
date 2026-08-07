# -*- coding: utf-8 -*-
"""模拟 coarse 组标点归因修复的预期效果（临时脚本）。"""
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


def gap_align(x: str, y: str) -> list | None:
    """EQ 合并版间隙对齐：实词串相同 → 标点归因输出；否则 None。"""
    wx, wy = de._strip_sep(x), de._strip_sep(y)
    if not wx or wx != wy:
        return None
    gx, cx = de._split_sep(x) if hasattr(de, "_split_sep") else _split(x)
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


def _split(s: str):
    gaps = [""]
    chars = []
    for c in s:
        if c in de._PUNCT_CHARS or c in de._WS_CHARS:
            gaps[-1] += c
        else:
            chars.append(c)
            gaps.append("")
    return gaps, chars


# 统计修复前后
kept_coarse = 0      # 保持段落级（真重写）
fixed_groups = 0     # 改为标点归因
fixed_del_chars = fixed_add_chars = 0
new_stats = {"total": 0, "add": 0, "del": 0, "mod": 0}
seg_count = 0

# 完整流水线模拟
dmp = None
raw_parts = []
d2b, a2b = [], []

def flush2():
    global d2b, a2b, dmp, kept_coarse, fixed_groups, fixed_del_chars, fixed_add_chars
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
        # ── 修复点：coarse 先做实词对齐 + W 空白归因 ──
        rebuilt = gap_align(d_text, a_text)
        if rebuilt is not None:
            fixed_groups += 1
            fixed_del_chars += dl
            fixed_add_chars += al
            rebuilt = de._resolve_whitespace(rebuilt)
            rebuilt = de._merge_adjacent(rebuilt)
            raw_parts.extend(rebuilt)
        else:
            kept_coarse += 1
            if d_text:
                raw_parts.append((-1, d_text))
            if a_text:
                raw_parts.append((1, a_text))
    d2b, a2b = [], []

from diff_match_patch import diff_match_patch
dmp = diff_match_patch()
dmp.Diff_Timeout = 30
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

print("修复前 stats:  {total: 6074, add: 2075, del: 3879, mod: 120}")
print("修复后 stats: ", stats)
print(f"coarse 组: 修复为标点归因 {fixed_groups} 组 / 保持段落级 {kept_coarse} 组")
print(f"归因区字符量: del {fixed_del_chars} + add {fixed_add_chars}")
# 重建校验
rebuilt_a = "".join(t for op, t in raw_diffs if op in (0, -1))
rebuilt_b = "".join(t for op, t in raw_diffs if op in (0, 1))
print("重建校验 B 严格相等:", rebuilt_b == B, "| A 允许空白差异:", de._strip_ws(rebuilt_a) == de._strip_ws(A))
