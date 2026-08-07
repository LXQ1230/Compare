# -*- coding: utf-8 -*-
"""验证方案 A 后 mod 22→303 的来源：U+2029 细粒度化的 2 组是否合理。"""
import sys, os, tempfile, shutil, hashlib, time
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
        align.append(("eq", i-1, j-1)); i -= 1; j -= 1
    elif dp[i-1][j] > dp[i][j-1]:
        align.append(("del", i-1)); i -= 1
    else:
        align.append(("add", j-1)); j -= 1
while i > 0:
    align.append(("del", i-1)); i -= 1
while j > 0:
    align.append(("add", j-1)); j -= 1
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

# 统计：修复后 coarse 组中「实词相同 → 间隙对齐」的组，它们输出里的 mod 来源
mod_source = Counter()
u2029_groups = []
for idx, (db, ab) in enumerate(groups):
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
        # 该组被细粒度化——统计 mod 来源
        ops = [(op, t) for op, t in rebuilt]
        n_del_pairs = sum(1 for k in range(len(ops)-1) if ops[k][0] == -1 and ops[k+1][0] == 1)
        n_add_pairs = sum(1 for k in range(len(ops)-1) if ops[k][0] == 1 and ops[k+1][0] == -1)
        has_sep = "\u2029" in d_text or "\u2029" in a_text
        # 含 U+2029 的组
        if has_sep:
            u2029_groups.append((idx, len(db), len(ab), len(ops), n_del_pairs, n_add_pairs,
                                 d_text[:60], a_text[:60]))
        # 统计这些组的 DEL/ADD 段数
        mod_source["gap_aligned_groups"] += 1
        mod_source["del_ops"] += sum(1 for op, _ in ops if op == -1)
        mod_source["add_ops"] += sum(1 for op, _ in ops if op == 1)

print(f"coarse 组中实词相同（间隙对齐细粒度化）总数: {mod_source['gap_aligned_groups']}")
print(f"  其中输出 DEL 段总数: {mod_source['del_ops']}, ADD 段总数: {mod_source['add_ops']}")
print(f"  相邻 DEL+ADD / ADD+DEL 对（会被 _build_segments 合成 mod）≈ {mod_source['del_ops'] + mod_source['add_ops']} 上限")
print()
print(f"含 U+2029 的细粒度化组: {len(u2029_groups)} 组")
for idx, nd, na, nops, ndp, nap, dh, ah in u2029_groups[:6]:
    print(f"  组#{idx}: del段={nd} add段={na} 输出ops={nops} DEL+ADD相邻对={ndp} ADD+DEL相邻对={nap}")
    print(f"    DEL[:50]: {dh!r}")
    print(f"    ADD[:50]: {ah!r}")
