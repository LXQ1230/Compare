# -*- coding: utf-8 -*-
"""方案 B 验证：模拟 diff_texts_para_lcs 内部归一化 LCS 对齐，统计 eq/替换组。"""
import sys, os, tempfile, shutil, hashlib, time
from collections import Counter

sys.path.insert(0, r"D:\Desktop\Compare")
from src_backend.parsers.idml_parser import parse_idml
import src_backend.diff_engine as de

src_a = r"D:\Desktop\新建文件夹 (2)\497有图.idml"
src_b = r"D:\Desktop\新建文件夹 (2)\497导出_WD注入.idml"
tmp_a = os.path.join(tempfile.gettempdir(), "497_a.idml")
tmp_b = os.path.join(tempfile.gettempdir(), "497_b.idml")
shutil.copy2(src_a, tmp_a); shutil.copy2(src_b, tmp_b)
A = parse_idml(tmp_a).text; B = parse_idml(tmp_b).text

pa = de._split_keep(A, de._SEP); pb = de._split_keep(B, de._SEP)
n, m = len(pa), len(pb)

ha_raw = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb_raw = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
ha_norm = [hashlib.md5(de._strip_sep(p).encode("utf-8")).hexdigest() for p in pa]
hb_norm = [hashlib.md5(de._strip_sep(p).encode("utf-8")).hexdigest() for p in pb]

# 归一化匹配率
exact = sum(1 for i in range(min(n, m)) if ha_raw[i] == hb_raw[i])
print(f"段落数: A={n} B={m}")
print(f"归一化后匹配段落数（等价替代）：{sum(1 for h in ha_norm if h in set(hb_norm))}")

t0 = time.time()
dp = [[0]*(m+1) for _ in range(n+1)]
for i in range(n):
    hn = ha_norm[i]
    row = dp[i]; nrow = dp[i+1]
    for j in range(m):
        nrow[j+1] = row[j]+1 if hn == hb_norm[j] else max(row[j+1], nrow[j])
print(f"LCS DP 耗时: {time.time()-t0:.2f}s")

align = []
i, j = n, m
while i > 0 and j > 0:
    if ha_norm[i-1] == hb_norm[j-1]:
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
opc = Counter(x[0] for x in align)
print(f"归一化 LCS 对齐: {dict(opc)}")

# 替换组统计
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
print(f"替换组总数: {len(groups)}")

# eq 段对分类：原文相同 vs 原文不同（需间隙对齐/DMP 细粒度化）
eq_same = eq_diff = 0
for item in align:
    if item[0] == "eq":
        ai, bi = item[1], item[2]
        if ha_raw[ai] == hb_raw[bi]:
            eq_same += 1
        else:
            eq_diff += 1
print(f"eq 段对: 原文相同={eq_same} 原文不同(需细粒度化)={eq_diff}")

# 替换组 fine/coarse 分类
fine = coarse = 0
for db, ab in groups:
    d_text = "".join(db); a_text = "".join(ab)
    dl, al = len(d_text), len(a_text)
    if (dl+al) <= de._REGION_DMP_MAX or (len(db)==1 and len(ab)==1 and (dl+al) <= de._PAIR_DMP_MAX):
        fine += 1
    else:
        coarse += 1
print(f"替换组分类: fine={fine} coarse={coarse}")

# 全部 eq 段对走间隙对齐的成功率
ok = fail = 0
for item in align:
    if item[0] == "eq":
        ai, bi = item[1], item[2]
        if ha_raw[ai] != hb_raw[bi]:
            r = de._coarse_punct_alignment(pa[ai], pb[bi])
            if r is not None:
                ok += 1
            else:
                fail += 1
print(f"eq 段对间隙对齐: 成功={ok} 回退DMP={fail}")
