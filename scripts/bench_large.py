"""
性能预研：全量 diff vs 分块 diff（合成中文大文档）。

用途:
  - 校准 docs/超大文件专项改造方案.md 的复杂度预估（§11.4 / §14.3 阈值）
  - 为决策 D2（分块策略）提供真实数据

用法:
  python scripts/bench_large.py --chars 1000000 --ratio 0.05 [--full]
  --full  额外跑全量 diff（100 万字可能非常慢，建议后台+超时）
"""
import argparse
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from diff_match_patch import diff_match_patch  # noqa: E402

SEED_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "275导出.txt"


def load_seed() -> str:
    return SEED_PATH.read_text(encoding="utf-8")


def gen_doc(seed: str, chars: int) -> str:
    """循环拼接种子文本至目标字符数；每行追加唯一编号，
    避免行内容重复触发 DMP 的重复文本优化（模拟真实文档行各异）。"""
    out: list[str] = []
    n = 0
    k = 0
    while n < chars:
        for ln in seed.split("\n"):
            if not ln:
                continue
            k += 1
            out.append(f"{ln}〔{k}〕")
            n += len(ln) + len(f"〔{k}〕") + 1
            if n >= chars:
                break
    return "\n".join(out)[:chars]


def mutate(doc: str, ratio: float, rng: random.Random) -> str:
    """按行施加增删改，ratio 为受影响行比例（近似字符差异率）。"""
    lines = doc.split("\n")
    res = []
    for ln in lines:
        r = rng.random()
        if r < ratio * 0.5:
            # 删除/替换后半行
            ln = ln[: max(0, len(ln) // 2)]
            if rng.random() < 0.5:
                ln = ln + rng.choice(["新增内容", "替换文本", "测试变更", "补充说明"])
        elif r < ratio:
            ln = ln + rng.choice(["新增内容", "替换文本", "测试变更", "补充说明"])
        res.append(ln)
    return "\n".join(res)


def mutate_struct(doc: str, ratio: float, rng: random.Random) -> str:
    """结构性变异（最坏场景）：整行随机插入/删除/移动，破坏公共前缀。"""
    lines = [ln for ln in doc.split("\n") if ln]
    n = len(lines)
    del_count = int(n * ratio * 0.3)
    ins_count = int(n * ratio * 0.3)
    move_count = int(n * ratio * 0.1)
    for _ in range(del_count):
        if lines:
            lines.pop(rng.randrange(len(lines)))
    pool = [f"新增段落内容测试文本{rng.randrange(10**6)}" for _ in range(ins_count)]
    for p in pool:
        lines.insert(rng.randrange(len(lines) + 1), p)
    for _ in range(move_count):
        if len(lines) < 2:
            break
        i, j = rng.randrange(len(lines)), rng.randrange(len(lines))
        lines.insert(j, lines.pop(i))
    return "\n".join(lines)


def windows(text: str, size: int = 20000) -> list[str]:
    """按行累积至 size 字符切块（在行边界对齐），模拟窗口分块。"""
    lines = text.split("\n")
    blocks: list[str] = []
    cur: list[str] = []
    n = 0
    for ln in lines:
        cur.append(ln)
        n += len(ln) + 1
        if n >= size:
            blocks.append("\n".join(cur))
            cur, n = [], 0
    if cur:
        blocks.append("\n".join(cur))
    return blocks


def time_full(a: str, b: str) -> float:
    dmp = diff_match_patch()
    dmp.Diff_Timeout = 0
    t0 = time.perf_counter()
    diffs = dmp.diff_main(a, b)
    dmp.diff_cleanupSemantic(diffs)
    return time.perf_counter() - t0


def time_chunked(a: str, b: str, size: int = 20000) -> float:
    """按固定窗口分块，块间按索引配对做 diff（量级估算，不做锚点对齐）。"""
    wa, wb = windows(a, size), windows(b, size)
    dmp = diff_match_patch()
    dmp.Diff_Timeout = 0
    total = 0.0
    n = max(len(wa), len(wb))
    for i in range(n):
        ta = wa[i] if i < len(wa) else ""
        tb = wb[i] if i < len(wb) else ""
        t0 = time.perf_counter()
        diffs = dmp.diff_main(ta, tb)
        dmp.diff_cleanupSemantic(diffs)
        total += time.perf_counter() - t0
    return total


def _line_hashes(text: str) -> list[str]:
    """行级 hash（含行尾），供锚点匹配。"""
    import zlib
    return [f"{zlib.crc32(ln.encode('utf-8')):08x}" for ln in text.split("\n")]


def time_anchor(a: str, b: str, min_anchor: int = 20) -> float:
    """
    锚点分块（方案 L1 的简化实现）：
    1. 行 hash 化；2. 选唯一公共长行做锚点（贪心顺序匹配）；
    3. 锚点间为块，块内 DMP；4. 累加块内耗时（不含锚点选择开销）。
    """
    import zlib

    def lines_hash(text: str) -> list[tuple[str, str]]:
        return [(ln, f"{zlib.crc32(ln.encode('utf-8')):08x}") for ln in text.split("\n")]

    la = lines_hash(a)
    lb = lines_hash(b)
    # orig 侧 index: hash -> 行号（仅 ≥MIN_ANCHOR 且唯一出现）
    from collections import defaultdict
    counter_a: dict[str, int] = defaultdict(int)
    for _, h in la:
        counter_a[h] += 1
    idx_a: dict[str, list[int]] = defaultdict(list)
    for i, (ln, h) in enumerate(la):
        if len(ln) >= min_anchor:
            idx_a[h].append(i)

    # 贪心匹配锚点
    anchors: list[tuple[int, int]] = []
    last_a, last_b = -1, -1
    for j, (ln, h) in enumerate(lb):
        if j <= last_b or len(ln) < min_anchor or counter_a[h] != 1:
            continue
        cands = [i for i in idx_a[h] if i > last_a]
        if not cands:
            continue
        i = cands[0]
        anchors.append((i, j))
        last_a, last_b = i, j

    # 锚点间切块（含首尾），块内 DMP 计时
    la_text = a.split("\n")
    lb_text = b.split("\n")
    dmp = diff_match_patch()
    dmp.Diff_Timeout = 0
    total = 0.0
    segs = [(-1, -1)] + anchors + [(len(la_text), len(lb_text))]
    for k in range(len(segs) - 1):
        a0, b0 = segs[k]
        a1, b1 = segs[k + 1]
        ta = "\n".join(la_text[a0 + 1:a1])
        tb = "\n".join(lb_text[b0 + 1:b1])
        t0 = time.perf_counter()
        diffs = dmp.diff_main(ta, tb)
        dmp.diff_cleanupSemantic(diffs)
        total += time.perf_counter() - t0
    return total


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chars", type=int, default=1_000_000)
    ap.add_argument("--ratio", type=float, default=0.05)
    ap.add_argument("--block", type=int, default=20000)
    ap.add_argument("--mode", choices=["window", "anchor", "both"], default="both")
    ap.add_argument("--mutate", choices=["light", "struct"], default="light",
                    help="light=行内修改(友好) struct=整行增删移动(最坏)")
    ap.add_argument("--full", action="store_true", help="额外跑全量 diff")
    args = ap.parse_args()

    rng = random.Random(42)
    seed = load_seed()
    print(f"seed: {len(seed)} 字符")

    a = gen_doc(seed, args.chars)
    b = mutate_struct(a, args.ratio, rng) if args.mutate == "struct" else mutate(a, args.ratio, rng)
    print(f"doc: A={len(a)} 字符, B={len(b)} 字符, 差异率≈{args.ratio:.0%}, 变异={args.mutate}")

    if args.mode in ("window", "both"):
        t0 = time.perf_counter()
        tc = time_chunked(a, b, args.block)
        n_blocks = max(len(windows(a, args.block)), len(windows(b, args.block)))
        print(f"[窗口分块] 块数={n_blocks} 块大小≈{args.block} 耗时={tc:.2f}s")

    if args.mode in ("anchor", "both"):
        t0 = time.perf_counter()
        ta_ = time_anchor(a, b)
        print(f"[锚点分块] 耗时={ta_:.2f}s")

    # 全量（可选，100 万可能很慢）
    if args.full:
        t0 = time.perf_counter()
        tf = time_full(a, b)
        tc = time_chunked(a, b, args.block)
        print(f"[全量] 耗时={tf:.2f}s  (vs窗口加速比={tf / max(tc, 1e-9):.1f}x)")


if __name__ == "__main__":
    main()
