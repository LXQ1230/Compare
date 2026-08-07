# -*- coding: utf-8 -*-
"""实验：归一化对齐的段对，用 DMP vs 间隙对齐（coarse）两种方式处理，
对比输出段数、stats 分布、耗时。决定方案 B 的段内处理实现。"""
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

# 修复版 _strip_sep（剥离 U+2029）
def strip_fixed(s):
    return "".join(c for c in s if c not in de._PUNCT_CHARS
                  and c not in de._WS_CHARS and c != de._SEP)

pa = de._split_keep(A, de._SEP)
pb = de._split_keep(B, de._SEP)
ha_raw = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb_raw = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
ha_norm = [hashlib.md5(strip_fixed(p).encode("utf-8")).hexdigest() for p in pa]
hb_norm = [hashlib.md5(strip_fixed(p).encode("utf-8")).hexdigest() for p in pb]

# 归一化哈希 LCS
n, m = len(pa), len(pb)
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
        align.append(("del", i-1)); i -= 1
    else:
        align.append(("add", j-1)); j -= 1
while i > 0:
    align.append(("del", i-1)); i -= 1
while j > 0:
    align.append(("add", j-1)); j -= 1
align.reverse()

# 收集"实词相同但原文不同"的段对
pairs = []
for item in align:
    if item[0] == "eq":
        ai, bi = item[1], item[2]
        if ha_raw[ai] != hb_raw[bi]:
            pairs.append((pa[ai], pb[bi], len(pa[ai]), len(pb[bi])))

print(f"归一化对齐但原文不同的段对: {len(pairs)}")
print(f"段长分布: min={min(p[2] for p in pairs)} max={max(p[2] for p in pairs)} "
      f"avg={sum(p[2] for p in pairs)//len(pairs)}")
print()

# ── 方式 1：段内 DMP（_diff_fine_group）──
dmp = diff_match_patch()
dmp.Diff_Timeout = 30
t0 = time.time()
segs_dmp = []
stats_dmp = Counter()
for x, y, _, _ in pairs:
    d = de._diff_fine_group(dmp, x, y)
    segs_dmp.append(d)
    for op, t in d:
        if op == -1: stats_dmp["del_chars"] += len(t)
        elif op == 1: stats_dmp["add_chars"] += len(t)
        elif op == 0: stats_dmp["eq_chars"] += len(t)
    # 统计操作数（分段）
    ops = [op for op, _ in d]
    stats_dmp["ops"] += len(ops)
    stats_dmp[f"op{'_'.join(map(str,ops))[:20]}"] += 0
t1 = time.time()
print(f"方式 1（段内 DMP）: 耗时 {t1-t0:.2f}s")
print(f"  总操作数: {stats_dmp['ops']}（{len(pairs)} 段对，平均 {stats_dmp['ops']/len(pairs):.1f} 段/对）")
print(f"  del_chars={stats_dmp['del_chars']} add_chars={stats_dmp['add_chars']} eq_chars={stats_dmp['eq_chars']}")
print()

# 统计 DMP 输出中相邻 DEL+ADD（会合成 mod）的段对数
mod_pairs = 0
for d in segs_dmp:
    has_mod = any(
        d[i][0] == -1 and i + 1 < len(d) and d[i+1][0] == 1
        for i in range(len(d))
    )
    if has_mod:
        mod_pairs += 1
print(f"  DMP 输出含相邻 DEL+ADD（→mod）的段对数: {mod_pairs}/{len(pairs)}")
print()

# ── 方式 2：间隙对齐（_coarse_punct_alignment）──
t0 = time.time()
segs_gap = []
stats_gap = Counter()
for x, y, _, _ in pairs:
    d = de._coarse_punct_alignment(x, y)
    if d is None:
        segs_gap.append(None)
        stats_gap["none"] += 1
        continue
    segs_gap.append(d)
    for op, t in d:
        if op == -1: stats_gap["del_chars"] += len(t)
        elif op == 1: stats_gap["add_chars"] += len(t)
        elif op == 0: stats_gap["eq_chars"] += len(t)
    stats_gap["ops"] += len(d)
t1 = time.time()
print(f"方式 2（间隙对齐 coarse）: 耗时 {t1-t0:.2f}s")
print(f"  总操作数: {stats_gap['ops']}（{len(pairs)} 段对，平均 {stats_gap['ops']/len(pairs):.1f} 段/对）")
print(f"  返回 None（归因失败）: {stats_gap['none']}")
print(f"  del_chars={stats_gap['del_chars']} add_chars={stats_gap['add_chars']} eq_chars={stats_gap['eq_chars']}")
print()

# ── 方式 3：W 归因折叠后的间隙对齐（_coarse_punct_alignment 内部已含）──
# 对比两种方式的"可见变更"统计
# 用 _build_segments 统计最终 stats（不含 eq 段）
print("=== 两种方式的最终 stats 对比（_build_segments）===")
for name, seglist in [("DMP", segs_dmp), ("Gap", segs_gap)]:
    total = add = dele = mod = 0
    for d in seglist:
        if d is None:
            continue
        # 手动模拟 _build_segments 的 mod 合成
        i = 0
        while i < len(d):
            op, t = d[i]
            if op == 0:
                i += 1
            elif op == 1:
                if i + 1 < len(d) and d[i+1][0] == -1:
                    mod += 1; i += 2
                else:
                    add += 1; i += 1
            else:
                if i + 1 < len(d) and d[i+1][0] == 1:
                    mod += 1; i += 2
                else:
                    dele += 1; i += 1
            total += 1
    print(f"  {name}: total_seg={total} add={add} del={dele} mod={mod}")

# ── 结论：如果方案B用间隙对齐代替 DMP，stats 会怎样 ──
# 用间隙对齐重建完整 raw_diffs，统计最终 stats
print()
print("=== 方案 B（用间隙对齐处理段对）的完整 stats ===")
raw_parts = []
dmp2 = diff_match_patch()
dmp2.Diff_Timeout = 30
del_buf, add_buf = [], []

def flush():
    global del_buf, add_buf
    if not del_buf and not add_buf:
        return
    d_text = "".join(del_buf)
    a_text = "".join(add_buf)
    dl, al = len(d_text), len(a_text)
    if dl + al <= de._REGION_DMP_MAX:
        raw_parts.extend(de._diff_fine_group(dmp2, d_text, a_text))
    elif len(del_buf) == 1 and len(add_buf) == 1 and dl + al <= de._PAIR_DMP_MAX:
        raw_parts.extend(de._diff_fine_group(dmp2, d_text, a_text))
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
        if ha_raw[ai] == hb_raw[bi]:
            raw_parts.append((0, pa[ai]))
        else:
            # 方案 B：用间隙对齐处理段对（替代 DMP）
            g = de._coarse_punct_alignment(pa[ai], pb[bi])
            if g is not None:
                raw_parts.extend(g)
            else:
                # 间隙对齐失败（异常，理论上不会）→ 回退 DMP
                raw_parts.extend(de._diff_fine_group(dmp2, pa[ai], pb[bi]))
    elif item[0] == "del":
        del_buf.append(pa[item[1]])
    else:
        add_buf.append(pb[item[1]])
flush()

raw_diffs = de._merge_adjacent(raw_parts)
segs, stats_b, _ = de._build_segments(raw_diffs)
print(f"方案 B（间隙对齐版）stats: {stats_b}")

# 当前方案 stats
segs_orig, stats_orig = de.diff_texts_with_style(A, B)
print(f"当前方案 stats:          {stats_orig}")
print(f"差异: total {stats_orig['total']}→{stats_b['total']} ({stats_b['total']-stats_orig['total']:+d}), "
      f"add {stats_orig['add']}→{stats_b['add']} ({stats_b['add']-stats_orig['add']:+d}), "
      f"del {stats_orig['del']}→{stats_b['del']} ({stats_b['del']-stats_orig['del']:+d}), "
      f"mod {stats_orig['mod']}→{stats_b['mod']} ({stats_b['mod']-stats_orig['mod']:+d})")
