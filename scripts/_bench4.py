"""瓶颈定位 v4 — 全量 DMP 各子步骤耗时（不含 cleanupSemantic 的对比）。"""
import sys
import time

sys.path.insert(0, r"D:\Desktop\Compare")

LOG = r"D:\Desktop\Compare\scripts\_bench4.log"
A_FILE = r"D:\Desktop\JidouInject\done\497\497有图.idml"
B_FILE = r"D:\Desktop\JidouInject\done\497\497导出_WD注入.idml"


def log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")


from src_backend.parsers import parse_idml
from diff_match_patch import diff_match_patch

ra = parse_idml(A_FILE)
rb = parse_idml(B_FILE)
a, b = ra.text, rb.text
log(f"parsed A={len(a)} B={len(b)}")

dmp = diff_match_patch()
dmp.Diff_Timeout = 0

t0 = time.time()
raw = dmp.diff_main(a, b)
t1 = time.time()
log(f"[A] diff_main no-cleanup: {t1-t0:.1f}s ops={len(raw)}")

t2 = time.time()
dmp.diff_cleanupSemantic(raw)
t3 = time.time()
log(f"[B] cleanupSemantic: {t3-t2:.1f}s ops={len(raw)}")

import src_backend.diff_engine as de

t4 = time.time()
r1 = de._resolve_punct_transposition(raw)
t5 = time.time()
log(f"[C] L1 transposition: {t5-t4:.1f}s")

t6 = time.time()
r2 = de._resolve_punct_substring(r1)
t7 = time.time()
log(f"[D] L2 substring: {t7-t6:.1f}s")

t8 = time.time()
r3 = de._resolve_punct_alignment(r2)
t9 = time.time()
log(f"[E] L3 alignment: {t9-t8:.1f}s")

t10 = time.time()
r4 = de._resolve_whitespace(r3)
t11 = time.time()
log(f"[F] W whitespace: {t11-t10:.1f}s")

t12 = time.time()
r5 = de._merge_adjacent(r4)
t13 = time.time()
log(f"[G] merge: {t13-t12:.1f}s ops={len(r5)}")
log("DONE")
