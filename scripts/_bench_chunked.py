"""锚点分块 diff 验证 v3 — 逐区间计时 + 内存监控 + 日志直写文件。"""
import sys
import time
import hashlib
import os
import psutil

sys.path.insert(0, r"D:\Desktop\Compare")

from src_backend.parsers import parse_idml
from diff_match_patch import diff_match_patch

LOG = r"D:\Desktop\Compare\scripts\_bench3.log"
A_FILE = r"D:\Desktop\JidouInject\done\497\497有图.idml"
B_FILE = r"D:\Desktop\JidouInject\done\497\497导出_WD注入.idml"
SEP = "\u2029"


def log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")


def mem_mb() -> int:
    return int(psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024)


log(f"start, mem={mem_mb()}MB")
ra = parse_idml(A_FILE)
log(f"parse A done, chars={len(ra.text)} spans={len(ra.spans)} mem={mem_mb()}MB")
rb = parse_idml(B_FILE)
log(f"parse B done, chars={len(rb.text)} spans={len(rb.spans)} mem={mem_mb()}MB")

a, b = ra.text, rb.text
pa = a.split(SEP)
pb = b.split(SEP)
log(f"paras A={len(pa)} B={len(pb)}")

ha = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]

anchors: list = []
ai = bi = 0
while ai < len(pa) and bi < len(pb):
    if ha[ai] == hb[bi]:
        anchors.append((ai, bi))
        ai += 1
        bi += 1
    else:
        found = False
        for j in range(bi, min(bi + 50, len(pb))):
            for k in range(ai, min(ai + 50, len(pa))):
                if ha[k] == hb[j]:
                    ai, bi = k, j
                    anchors.append((ai, bi))
                    ai += 1
                    bi += 1
                    found = True
                    break
            if found:
                break
        if not found:
            ai += 1
log(f"anchors={len(anchors)}")

# 构造区间
regions = []
prev_ai = prev_bi = 0
for a_i, b_i in anchors:
    regions.append((prev_ai, a_i, prev_bi, b_i, a_i, b_i))
    prev_ai, prev_bi = a_i + 1, b_i + 1
regions.append((prev_ai, len(pa), prev_bi, len(pb), -1, -1))

dmp = diff_match_patch()
dmp.Diff_Timeout = 0
t0 = time.time()
raw_parts: list = []
slow_regions = []
for idx, (as_, ae, bs_, be, a_anchor, b_anchor) in enumerate(regions):
    # 锚点段（EQUAL）
    if a_anchor >= 0:
        raw_parts.append((0, pa[a_anchor]))
    region_a = SEP.join(pa[as_:ae])
    region_b = SEP.join(pb[bs_:be])
    if not region_a and not region_b:
        continue
    size = len(region_a) + len(region_b)
    t = time.time()
    d = dmp.diff_main(region_a, region_b)
    dt = time.time() - t
    if dt > 2.0 or size > 50000:
        slow_regions.append((idx, size, dt, len(d)))
        log(f"region#{idx} size={size} dt={dt:.1f}s ops={len(d)} mem={mem_mb()}MB")
    raw_parts.extend(d)
    if idx % 50 == 0:
        log(f"region#{idx}/{len(regions)} size={size} dt={dt:.2f}s mem={mem_mb()}MB")

t1 = time.time()
log(f"chunked diff done: {t1 - t0:.2f}s ops={len(raw_parts)} slow={slow_regions}")

# 一致性验证
ra_re = "".join(t for op, t in raw_parts if op in (0, -1))
rb_re = "".join(t for op, t in raw_parts if op in (0, 1))
log(f"rebuild A match: {ra_re == a}  rebuild B match: {rb_re == b}")
log(f"mem final={mem_mb()}MB")
log("DONE")
