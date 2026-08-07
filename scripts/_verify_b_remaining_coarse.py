# -*- coding: utf-8 -*-
"""方案 B 残余 coarse 组内容验证：确认是真实内容重排/重写（段落级展示合理）。"""
import sys, os, tempfile, shutil, hashlib
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
ha_norm = [hashlib.md5(de._strip_sep(p).encode("utf-8")).hexdigest() for p in pa]
hb_norm = [hashlib.md5(de._strip_sep(p).encode("utf-8")).hexdigest() for p in pb]
n, m = len(pa), len(pb)

dp = [[0]*(m+1) for _ in range(n+1)]
for i in range(n):
    hn = ha_norm[i]; row = dp[i]; nrow = dp[i+1]
    for j in range(m):
        nrow[j+1] = row[j]+1 if hn == hb_norm[j] else max(row[j+1], nrow[j])
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

print(f"替换组总数: {len(groups)}")
for gi, (db, ab) in enumerate(groups):
    d_text = "".join(db); a_text = "".join(ab)
    dl, al = len(d_text), len(a_text)
    is_fine = (dl+al) <= de._REGION_DMP_MAX or (len(db)==1 and len(ab)==1 and (dl+al) <= de._PAIR_DMP_MAX)
    tag = "fine" if is_fine else "COARSE"
    rebuilt = de._coarse_punct_alignment(d_text, a_text)
    print(f"\n组#{gi} [{tag}] del段={len(db)} add段={len(ab)} dlen={dl} alen={al}")
    print(f"  coarse 归因: {'成功(实词相同)' if rebuilt is not None else '失败(真重写→段落级)'}")
    if rebuilt is None:
        print(f"  DEL[:80]: {d_text[:80]!r}")
        print(f"  ADD[:80]: {a_text[:80]!r}")
