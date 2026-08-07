# -*- coding: utf-8 -*-
"""方案 B 边界检查：归一化后为空的段落、哈希冲突、重复段落。"""
import sys, os, tempfile, shutil, hashlib
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

def strip_fixed(s):
    return "".join(c for c in s if c not in de._PUNCT_CHARS
                  and c not in de._WS_CHARS and c != de._SEP)

pa = de._split_keep(A, de._SEP)
pb = de._split_keep(B, de._SEP)

# 1. 归一化后为空的段落数
empty_a = sum(1 for p in pa if not strip_fixed(p))
empty_b = sum(1 for p in pb if not strip_fixed(p))
print(f"1. 归一化后为空的段落: A={empty_a}, B={empty_b}")
if empty_a:
    samples = [p for p in pa if not strip_fixed(p)][:5]
    print(f"   A 空段示例: {[repr(s[:40]) for s in samples]}")
print()

# 2. 归一化哈希冲突：不同原文但相同归一化
ha_norm = [strip_fixed(p) for p in pa]
hb_norm = [strip_fixed(p) for p in pb]
norm_counter = Counter(ha_norm)
dups = {k: v for k, v in norm_counter.items() if v > 1 and k}
print(f"2. A 侧归一化哈希重复（不同段落同归一化）: {len(dups)} 组")
if dups:
    top = sorted(dups.items(), key=lambda kv: -kv[1])[:5]
    for k, v in top:
        print(f"   '{k[:40]}...' x{v}")
        # 对应原文
        idxs = [i for i, n in enumerate(ha_norm) if n == k][:3]
        for i in idxs:
            print(f"     段落{i}: {repr(pa[i][:60])}")
print()

# 3. 归一化空哈希（空串）匹配情况
empty_norm = ""
empty_a_cnt = sum(1 for n in ha_norm if n == empty_norm)
empty_b_cnt = sum(1 for n in hb_norm if n == empty_norm)
print(f"3. 空归一化串: A={empty_a_cnt}, B={empty_b_cnt}")
print()

# 4. 检查"实词相同但标点不同"段对中，是否含纯标点/空段
# 用 LCS 找对齐，看空段对是否匹配到非空段
n, m = len(pa), len(pb)
ha_raw = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb_raw = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
ha_nh = [hashlib.md5(strip_fixed(p).encode("utf-8")).hexdigest() for p in pa]
hb_nh = [hashlib.md5(strip_fixed(p).encode("utf-8")).hexdigest() for p in pb]

dp = [[0]*(m+1) for _ in range(n+1)]
for i in range(n):
    hn = ha_nh[i]
    row = dp[i]
    nrow = dp[i+1]
    for j in range(m):
        if hn == hb_nh[j]:
            nrow[j+1] = row[j] + 1
        else:
            nrow[j+1] = max(row[j+1], nrow[j])

align = []
i, j = n, m
while i > 0 and j > 0:
    if ha_nh[i-1] == hb_nh[j-1]:
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

# 检查空归一化段对的匹配质量
bad_pairs = []
for item in align:
    if item[0] == "eq":
        ai, bi = item[1], item[2]
        if not strip_fixed(pa[ai]) or not strip_fixed(pb[bi]):
            # 至少一侧为空归一化
            if pa[ai] != pb[bi]:
                bad_pairs.append((pa[ai], pb[bi]))

print(f"4. 空归一化段对（两侧原文不同）: {len(bad_pairs)}")
for x, y in bad_pairs[:8]:
    print(f"   A={repr(x[:50])} B={repr(y[:50])}")
    # 检查间隙对齐或 DMP 能否处理
    g = de._coarse_punct_alignment(x, y)
    print(f"     coarse: {g is not None and len(g)} 段" if g is not None else "     coarse: None（回退 DMP）")
