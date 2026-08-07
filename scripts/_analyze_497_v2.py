# -*- coding: utf-8 -*-
"""分析 497 IDML 对比中整段 DEL+ADD 的成因（v2，完整版）。"""
import sys, os, tempfile, shutil, time, hashlib, difflib
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
print(f"A: {len(A)} chars, B: {len(B)} chars")

# ── 完整 diff ──
t0 = time.time()
segments, stats = de.diff_texts_with_style(A, B)
t1 = time.time()
print(f"diff 耗时: {t1-t0:.2f}s")
print(f"stats: {stats}")
print()

# ── 段落级 LCS 分析 ──
pa = de._split_keep(A, de._SEP)
pb = de._split_keep(B, de._SEP)
ha = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
n, m = len(pa), len(pb)
print(f"A: {n} paragraphs, B: {m} paragraphs")

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

opc = Counter(x[0] for x in align)
print(f"LCS 对齐操作: {dict(opc)}")
print()

# ── 替换组分类统计 ──
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

dmp = diff_match_patch()
dmp.Diff_Timeout = 30
fine_groups = coarse_groups = 0
fine_del = fine_add = 0
coarse_del = coarse_add = 0
similar_but_coarse = 0
examples = []
coarse_sizes = []
punct_saved = 0

for db, ab in groups:
    d_text = "".join(db)
    a_text = "".join(ab)
    dl, al = len(d_text), len(a_text)

    is_fine = False
    if dl + al <= de._REGION_DMP_MAX:
        is_fine = True
    elif len(db) == 1 and len(ab) == 1 and dl + al <= de._PAIR_DMP_MAX:
        is_fine = True

    if is_fine:
        fine_groups += 1
        d = de._diff_fine_group(dmp, d_text, a_text)
        for op, t in d:
            if op == -1: fine_del += len(t)
            elif op == 1: fine_add += len(t)
    else:
        coarse_groups += 1
        coarse_del += dl
        coarse_add += al
        coarse_sizes.append(dl + al)

        # 检查标点归因是否成功
        rebuilt = de._coarse_punct_alignment(d_text, a_text)
        if rebuilt is not None:
            similar_but_coarse += 1
            punct_saved += dl + al
        else:
            # 真重写，采样
            if len(examples) < 5:
                ratio = difflib.SequenceMatcher(
                    None, de._strip_sep(d_text), de._strip_sep(a_text)
                ).ratio()
                examples.append((ratio, d_text, a_text, len(db), len(ab)))

print(f"替换组: fine(字符级)={fine_groups} 组 | coarse(段落级)={coarse_groups} 组")
print(f"fine 组内 DMP: del 字符={fine_del} add 字符={fine_add}")
print(f"coarse 组: del 字符={coarse_del} add 字符={coarse_add}")
print(f"coarse 组中标点归因成功(实词相同)={similar_but_coarse}/{coarse_groups}")
print(f"标点归因拯救字符量: {punct_saved}")
print(f"coarse 组大小分布: min={min(coarse_sizes) if coarse_sizes else 0} "
      f"max={max(coarse_sizes) if coarse_sizes else 0} "
      f"avg={sum(coarse_sizes)//len(coarse_sizes) if coarse_sizes else 0}")
print()

# ── 真重写组详细分析 ──
print("=== coarse 组真重写示例（实词不同，保持段落级 DEL+ADD）===")
for ratio, d, a, nd, na in examples:
    print(f"  ratio={ratio:.2f} del段={nd} add段={na} dlen={len(d)} alen={len(a)}")
    # 找出实词差异
    wx = de._strip_sep(d)
    wy = de._strip_sep(a)
    # 简单 diff 实词
    sm = difflib.SequenceMatcher(None, wx, wy)
    real_diffs = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            real_diffs.append(f"{tag}: '{wx[i1:i2]}' -> '{wy[j1:j2]}'")
    print(f"    实词差异: {real_diffs[:5]}")
    print(f"    DEL[:120]: {d[:120]!r}")
    print(f"    ADD[:120]: {a[:120]!r}")
    print()

# ── 整段 DEL+ADD 占最终 stats 的比例 ──
# coarse 真重写组贡献的 del/add 段数
true_rewrite_del_chars = 0
true_rewrite_add_chars = 0
for db, ab in groups:
    d_text = "".join(db)
    a_text = "".join(ab)
    dl, al = len(d_text), len(a_text)
    is_fine = (dl + al <= de._REGION_DMP_MAX) or (
        len(db) == 1 and len(ab) == 1 and dl + al <= de._PAIR_DMP_MAX
    )
    if not is_fine:
        rebuilt = de._coarse_punct_alignment(d_text, a_text)
        if rebuilt is None:
            true_rewrite_del_chars += dl
            true_rewrite_add_chars += al

print(f"=== 真重写（coarse + 实词不同）贡献 ===")
print(f"DEL 字符: {true_rewrite_del_chars}")
print(f"ADD 字符: {true_rewrite_add_chars}")
print(f"占 stats del/add 比例: "
      f"del={true_rewrite_del_chars}/{stats.get('del',0)+stats.get('mod',0)} "
      f"add={true_rewrite_add_chars}/{stats.get('add',0)+stats.get('mod',0)}")
