"""方案 v5.1 — 段落序列 LCS + 替换区局部字符 DMP：耗时与一致性验证。"""
import sys
import time
import hashlib

sys.path.insert(0, r"D:\Desktop\Compare")

LOG = r"D:\Desktop\Compare\scripts\_bench5b.log"
A_FILE = r"D:\Desktop\JidouInject\done\497\497有图.idml"
B_FILE = r"D:\Desktop\JidouInject\done\497\497导出_WD注入.idml"
SEP = "\u2029"
HSEP = "\u0001"  # hash 分隔符（hex 不会与之冲突）


def log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")


from src_backend.parsers import parse_idml
from diff_match_patch import diff_match_patch

ra = parse_idml(A_FILE)
rb = parse_idml(B_FILE)
a, b = ra.text, rb.text
pa = a.split(SEP)
pb = b.split(SEP)
log(f"parsed A={len(a)} B={len(b)} paras A={len(pa)} B={len(pb)}")

ha = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
hb = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
sa = HSEP.join(ha)
sb = HSEP.join(hb)

dmp = diff_match_patch()
dmp.Diff_Timeout = 0
t0 = time.time()
seq_diff = dmp.diff_main(sa, sb)
t1 = time.time()
log(f"para-seq diff: {t1-t0:.2f}s ops={len(seq_diff)}")

# 消费段落游标构建输出
raw_parts: list = []
idx_a = 0
idx_b = 0
region_a_parts: list = []
region_b_parts: list = []
regions: list = []
eq_count = 0


def flush_region():
    global region_a_parts, region_b_parts
    ra_txt = SEP.join(region_a_parts)
    rb_txt = SEP.join(region_b_parts)
    if ra_txt or rb_txt:
        regions.append((ra_txt, rb_txt))
    region_a_parts = []
    region_b_parts = []


for op, txt in seq_diff:
    if op == 0:
        for ph in txt.split(HSEP):
            # 每个 hash 段（含空串）对应一个段落位置，全部消费
            flush_region()
            raw_parts.append((0, pa[idx_a]))
            idx_a += 1
            idx_b += 1
            eq_count += 1
    elif op == -1:
        for ph in txt.split(HSEP):
            if ph or True:
                region_a_parts.append(pa[idx_a])
                idx_a += 1
    elif op == 1:
        for ph in txt.split(HSEP):
            region_b_parts.append(pb[idx_b])
            idx_b += 1
flush_region()

log(f"regions={len(regions)} eq={eq_count} consumed a={idx_a}/{len(pa)} b={idx_b}/{len(pb)}")

# 字符级 DMP（仅变化区）
t0 = time.time()
slow = []
total_region_chars = 0
for i, (ra_txt, rb_txt) in enumerate(regions):
    total_region_chars += len(ra_txt) + len(rb_txt)
    if not ra_txt and not rb_txt:
        continue
    t = time.time()
    d = dmp.diff_main(ra_txt, rb_txt)
    dt = time.time() - t
    if dt > 0.5:
        slow.append((i, len(ra_txt) + len(rb_txt), round(dt, 1), len(d)))
    raw_parts.extend(d)
t1 = time.time()
log(f"region char-dmp: {t1-t0:.2f}s region_chars={total_region_chars} slow={slow[:8]}")

ra_re = "".join(t for op, t in raw_parts if op in (0, -1))
rb_re = "".join(t for op, t in raw_parts if op in (0, 1))
log(f"rebuild A match: {ra_re == a}  rebuild B match: {rb_re == b}")
log("DONE")
