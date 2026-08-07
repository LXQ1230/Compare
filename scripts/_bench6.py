"""最终方案验证 v7 — 保留 SEP 的段落切分 + LCS + 替换组限长：耗时与一致性。"""
import sys
import time
import hashlib

sys.path.insert(0, r"D:\Desktop\Compare")

LOG = r"D:\Desktop\Compare\scripts\_bench7.log"
A_FILE = r"D:\Desktop\JidouInject\done\497\497有图.idml"
B_FILE = r"D:\Desktop\JidouInject\done\497\497导出_WD注入.idml"
SEP = "\u2029"
REGION_DMP_MAX = 4096
PAIR_DMP_MAX = 2048


def log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")


def split_keep(text: str, sep: str) -> list:
    """按 sep 切分且保留 sep 在段尾（最后一段除外）。"""
    parts = text.split(sep)
    out = []
    for p in parts[:-1]:
        out.append(p + sep)
    if parts:
        out.append(parts[-1])
    return out


from src_backend.parsers import parse_idml
from diff_match_patch import diff_match_patch

ra = parse_idml(A_FILE)
rb = parse_idml(B_FILE)
a, b = ra.text, rb.text
pa = split_keep(a, SEP)
pb = split_keep(b, SEP)
log(f"parsed A={len(a)} B={len(b)} paras A={len(pa)} B={len(pb)}")

ha = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]

# ── 段落级 LCS（完整 DP 矩阵） ──
t0 = time.time()
n, m = len(pa), len(pb)
dp = [[0] * (m + 1) for _ in range(n + 1)]
for i in range(n):
    hi = ha[i]
    row = dp[i]
    nrow = dp[i + 1]
    for j in range(m):
        if hi == hb[j]:
            nrow[j + 1] = row[j] + 1
        else:
            nrow[j + 1] = max(row[j + 1], nrow[j])
lcs_len = dp[n][m]
t1 = time.time()
log(f"para LCS: {t1-t0:.2f}s lcs_len={lcs_len}")

# 回溯
t0 = time.time()
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
t1 = time.time()
log(
    f"backtrack: {t1-t0:.2f}s align_len={len(align)} "
    f"eq={sum(1 for x in align if x[0]=='eq')} "
    f"del={sum(1 for x in align if x[0]=='del')} "
    f"add={sum(1 for x in align if x[0]=='add')}"
)

# ── 组装 raw_diffs ──
dmp = diff_match_patch()
dmp.Diff_Timeout = 30

t0 = time.time()
raw_parts: list = []
del_buf: list = []
add_buf: list = []
fine = 0
coarse = 0


def flush_pair():
    global del_buf, add_buf, fine, coarse
    if not del_buf and not add_buf:
        return
    d_text = "".join(del_buf)
    a_text = "".join(add_buf)
    d_len = len(d_text)
    a_len = len(a_text)
    if (d_len + a_len) <= REGION_DMP_MAX:
        d = dmp.diff_main(d_text, a_text)
        fine += 1
        raw_parts.extend(d)
    elif len(del_buf) == 1 and len(add_buf) == 1 and (d_len + a_len) <= PAIR_DMP_MAX:
        d = dmp.diff_main(d_text, a_text)
        fine += 1
        raw_parts.extend(d)
    else:
        coarse += 1
        if d_text:
            raw_parts.append((-1, d_text))
        if a_text:
            raw_parts.append((1, a_text))
    del_buf = []
    add_buf = []


for item in align:
    if item[0] == "eq":
        flush_pair()
        raw_parts.append((0, pa[item[1]]))
    elif item[0] == "del":
        del_buf.append(pa[item[1]])
    else:
        add_buf.append(pb[item[1]])
flush_pair()
t1 = time.time()
log(f"assemble: {t1-t0:.2f}s fine={fine} coarse={coarse} ops={len(raw_parts)}")

# ── 一致性验证 ──
ra_re = "".join(t for op, t in raw_parts if op in (0, -1))
rb_re = "".join(t for op, t in raw_parts if op in (0, 1))
ok_a = ra_re == a
ok_b = rb_re == b
log(f"rebuild A match: {ok_a}  rebuild B match: {ok_b}")

if not (ok_a and ok_b):
    for side, rebuilt, orig in (("A", ra_re, a), ("B", rb_re, b)):
        if rebuilt == orig:
            continue
        k = 0
        while k < min(len(rebuilt), len(orig)) and rebuilt[k] == orig[k]:
            k += 1
        log(
            f"  side {side} first diff at {k}: "
            f"orig={orig[max(0,k-15):k+15]!r} rebuilt={rebuilt[max(0,k-15):k+15]!r}"
        )
log("DONE")
