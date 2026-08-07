"""Diff engine wrapper around google-diff-match-patch."""

import hashlib

from diff_match_patch import diff_match_patch

# ── 大文档段落级 LCS 流水线（v7 已验证：63 万字 3.7s vs 全局 DMP 129s）──
_SEP = "\u2029"                     # IDML 段落分隔符（保留在段尾）
_LARGE_DOC_THRESHOLD = 150_000     # max(len) ≥ 此值走段落 LCS 路径
_REGION_DMP_MAX = 4096             # 替换组总长 ≤ 此值 → 组内字符级 DMP
_PAIR_DMP_MAX = 2048               # 单对（1 del 段 + 1 add 段）≤ 此值 → 组内 DMP
_DMP_FINE_TIMEOUT = 30             # 组内 DMP 超时兜底（秒）
_PARA_LCS_MAX_CELLS = 5_000_000    # 段落 LCS DP 矩阵格数上限（防内存失控）

# 标点字符集（标点移动优先重写用）——中文标点 + 英文标点
_PUNCT_CHARS = set(
    "。！？；：，、…—～「」『』（）《》〈〉【】〔〕｛｝"
    ",.;:!?…—~\"'()[]{}"
)

# 空白符集合：换行/制表/全角空格/Unicode 空格/BOM。
# 空白符是排版符号而非内容——句读编辑中「行尾回车/空格 → 标点」是常规操作，
# 空白符的增删不应单独标记（用户实测 2026-08-05：Word 句读结果大量出现）。
_WS_CHARS = set(
    "\n\r\t\u3000"                       # LF/CR/TAB/全角空格
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"  # Unicode 空格区
    "\u00a0\u202f\u205f"                 # NBSP/NNBSP/MMSP
    "\ufeff"                             # BOM（ZERO WIDTH NO-BREAK SPACE）
    " "                                  # 半角空格
)

# 交换检测间隔上限：del X 与 add X 之间的标点间隔超过此长度则视为独立操作
_PUNCT_TRANSPOSE_GAP_LIMIT = 8


def _is_punct(s: str) -> bool:
    return all(c in _PUNCT_CHARS for c in s)


def _is_ws(s: str) -> bool:
    """是否纯空白符（排版符号，非内容）。"""
    return all(c in _WS_CHARS for c in s)


def _strip_punct(s: str) -> str:
    return "".join(c for c in s if c not in _PUNCT_CHARS)


def _strip_sep(s: str) -> str:
    """去掉标点、空白与 U+2029（段落分隔符），仅留内容实词。

    U+2029 是段落结构符（IDML `<Br/>` 映射而来）而非内容字符，在实词
    比较中应视为分隔符（与标点、空白同族）——否则实词串会含 U+2029，
    导致「仅段落分隔符位置差异」的段对被误判为实词不同（2026-08-07 修复）。
    """
    return "".join(c for c in s if c not in _PUNCT_CHARS and c not in _WS_CHARS and c != _SEP)


def _strip_ws(s: str) -> str:
    """仅去掉空白符（保留标点）——重建校验 A 侧用（W 归因隐藏孤立空白）。"""
    return "".join(c for c in s if c not in _WS_CHARS)


def _merge_adjacent(raw_diffs: list) -> list:
    """合并相邻同类操作（ADD+ADD → ADD），保证重写后输出整洁。"""
    out = []
    for op, text in raw_diffs:
        if out and out[-1][0] == op:
            out[-1] = (op, out[-1][1] + text)
        else:
            out.append((op, text))
    return out


def _resolve_punct_transposition(raw_diffs: list, gap_limit: int = _PUNCT_TRANSPOSE_GAP_LIMIT):
    """标点移动优先：把「del X + (短标点间隔) + add X」重写为「add 标点 + X + del 标点」。

    背景（用户实测 2026-08-04）：原文「舎衛國。在」改为「舎衛。國在」——
    DMP 的最小编辑有两种等价解释：
      A) 移动实词：del '國' + keep '。' + add '國'   （DMP 默认）
      B) 移动标点：add '。' + keep '國' + del '。'   （用户实际做的：句号前移）
    两种解释的 A/B 两侧文本重构完全一致（数学等价），仅「哪个字符被视为移动」
    的语义不同。佛经句读场景中「修正标点位置」远多于「移动实词」，故优先选 B。

    规则：仅当 X 非空、间隔 Y 非空且全部为标点、间隔 ≤ gap_limit 时重写，
    防止把相距很远的「真删除 X + 真新增 X」误判为交换。
    """
    n = len(raw_diffs)
    if n < 3:
        return raw_diffs
    out = []
    i = 0
    while i < n:
        op, text = raw_diffs[i]
        if (
            op == -1 and text
            and i + 2 < n
            and raw_diffs[i + 1][0] == 0
            and raw_diffs[i + 2][0] == 1
            and raw_diffs[i + 2][1] == text
        ):
            gap = raw_diffs[i + 1][1]
            if 0 < len(gap) <= gap_limit and all(c in _PUNCT_CHARS for c in gap):
                out.append((1, gap))
                out.append((0, text))
                out.append((-1, gap))
                i += 3
                continue
        out.append((op, text))
        i += 1
    return out


def _resolve_punct_substring(raw_diffs: list) -> list:
    """标点包裹优先（L2）：把「DEL X + ADD Y」（X⊂Y 或 Y⊂X，两侧纯标点）
    重写为「ADD 标点 + EQ 实词 + ADD 标点」或「DEL 标点 + EQ 实词 + DEL 标点」。

    背景（用户实测 2026-08-05）：原文「我聞如是」改为「我。聞。如是。」——
    DMP 输出 DEL '聞' + ADD '。聞。'，把实词'聞'标成替换；用户实际只是加标点。
    佛经句读场景中「加/删标点」远多于「替换实词」，故优先把变更归因于标点。
    与 _resolve_punct_transposition 同族（标点归因 L1），属第二层：

      - X⊂Y（Y=P+X+Q）：重写为 ADD P + EQ X + ADD Q   （插入标点）
      - Y⊂X（X=P+Y+Q）：重写为 DEL P + EQ Y + DEL Q   （删除标点）

    仅当 P、Q 均为纯标点（可为空、至少一侧非空）时重写；
    两侧含汉字（真替换，如'。見聞。'）则不重写，保持 DMP 原样。
    """
    n = len(raw_diffs)
    if n < 2:
        return raw_diffs
    out = []
    i = 0
    while i < n:
        op, text = raw_diffs[i]
        if (
            op == -1 and text
            and i + 1 < n
            and raw_diffs[i + 1][0] == 1
            and raw_diffs[i + 1][1]
        ):
            x = text
            y = raw_diffs[i + 1][1]
            # 插入方向：Y = P + X + Q
            idx = y.find(x)
            if idx != -1:
                p, q = y[:idx], y[idx + len(x):]
                if (p or q) and _is_punct(p) and _is_punct(q):
                    if p:
                        out.append((1, p))
                    out.append((0, x))
                    if q:
                        out.append((1, q))
                    i += 2
                    continue
            # 删除方向：X = P + Y + Q
            idx = x.find(y)
            if idx != -1:
                p, q = x[:idx], x[idx + len(y):]
                if (p or q) and _is_punct(p) and _is_punct(q):
                    if p:
                        out.append((-1, p))
                    out.append((0, y))
                    if q:
                        out.append((-1, q))
                    i += 2
                    continue
        out.append((op, text))
        i += 1
    return out


def _align_gap_pair(d: str, a: str) -> list:
    """间隙对齐核心：把 gap 对 (d, a) 输出为 ops 序列。

    公共前缀/后缀保持 EQ，中间差异部分输出 DEL/ADD——而非整体替换。
    2026-08-07（方案 A 增强）：U+2029 作为分隔符后，若 gap 整体比较，
    「誦\\u2029 → 誦。\\u2029」（用户只加句号）会输出 DEL '\\u2029' +
    ADD '。\\u2029' 合成 mod；公共对齐后输出 ADD '。' + EQ '\\u2029'，
    标点插入显示干净，段落分隔符（结构未变）保持 EQ 可见。
    """
    if d == a:
        return [(0, d)] if d else []
    out = []
    # 公共前缀
    i = 0
    while i < len(d) and i < len(a) and d[i] == a[i]:
        i += 1
    if i:
        out.append((0, d[:i]))
    # 公共后缀（前缀之后）
    jd, ja = len(d), len(a)
    while jd > i and ja > i and d[jd - 1] == a[ja - 1]:
        jd -= 1
        ja -= 1
    if jd > i:
        out.append((-1, d[i:jd]))
    if ja > i:
        out.append((1, a[i:ja]))
    if jd < len(d):
        out.append((0, d[jd:]))
    return out


def _resolve_punct_alignment(raw_diffs: list) -> list:
    """实词对齐兜底（L3）：把「DEL X + ADD Y」中去标点与空白后实词串相同的对，
    强制按标点归因重写。这是标点归因三层的最后防线：
    只要用户未改实词（去分隔符后实词串一致），无论 DMP 怎么切，变更都归因于标点。

    实现（间隙对齐）：把 X、Y 各自的分隔符段（标点/空白）对齐到共同实词串 W 的
    n+1 个间隙，按「间隙0 + w1 + 间隙1 + ... + wk + 间隙k」交错输出：
    DEL X侧分隔符 + EQ 实词 + ADD Y侧分隔符。分隔符保留在各自侧原始相对位置，
    两侧文本重组后与原始 A/B 完全一致（数学等价，无信息丢失）。

    边界：
      - 同一间隙两侧都有分隔符且不同 = 标点/空白替换 → 保持 DEL+ADD（mod 语义）
      - 两侧全为分隔符（无实词可对齐）或实词不同 → 不重写
      - 重写后首/尾操作与前后操作相邻形成 DEL/ADD 邻接（会被分段合成 mod）
        → 放弃重写（保守，保持 DMP 原样）
    """
    n = len(raw_diffs)
    if n < 2:
        return raw_diffs

    def split_by_sep(s: str) -> tuple[list[str], list[str]]:
        """把 s 拆为 (gaps, chars)：标点、空白与 U+2029 都视为分隔符。
        gaps[k] 为第 k 个实词字符前的分隔符段，gaps[len(chars)] 为末尾段；
        chars 为非分隔符字符（内容实词）列表。"""
        gaps = [""]
        chars = []
        for c in s:
            if c in _PUNCT_CHARS or c in _WS_CHARS or c == _SEP:
                gaps[-1] += c
            else:
                chars.append(c)
                gaps.append("")
        return gaps, chars

    out = []
    i = 0
    while i < n:
        op, text = raw_diffs[i]
        if (
            op == -1 and text
            and i + 1 < n
            and raw_diffs[i + 1][0] == 1
            and raw_diffs[i + 1][1]
        ):
            x = text
            y = raw_diffs[i + 1][1]
            wx, wy = _strip_sep(x), _strip_sep(y)
            if x != y and wx == wy and wx:
                gx, cx = split_by_sep(x)
                gy, cy = split_by_sep(y)
                if cx == cy:
                    rebuilt: list = []
                    for k, wch in enumerate(cx):
                        rebuilt.extend(_align_gap_pair(gx[k], gy[k]))
                        rebuilt.append((0, wch))
                    rebuilt.extend(_align_gap_pair(gx[len(cx)], gy[len(cy)]))
                    # 邻接安全检查：防止重写后的 DEL/ADD 与前后操作相邻被合成 mod
                    safe = True
                    if rebuilt:
                        first_op, last_op = rebuilt[0][0], rebuilt[-1][0]
                        prev_op = out[-1][0] if out else None
                        nxt_op = raw_diffs[i + 2][0] if i + 2 < n else None
                        if (prev_op == 1 and first_op == -1) or (prev_op == -1 and first_op == 1):
                            safe = False
                        if (nxt_op == 1 and last_op == -1) or (nxt_op == -1 and last_op == 1):
                            safe = False
                    if safe:
                        out.extend(rebuilt)
                        i += 2
                        continue
        out.append((op, text))
        i += 1
    return out


def _resolve_whitespace(raw_diffs: list) -> list:
    """空白归因（W，2026-08-05 用户实测）：空白符是排版符号而非内容。

    背景：Word 句读结果把「行尾回车/全角空格 → 标点」作为常规操作——
    原「道祖筆受\\n」改「道祖筆受。」，DMP 输出 DEL '\\n' + ADD '。' 标成 mod，
    用户期望只显示「受」后新增「。」，回车符的删除不应单独标记。

    规则：
      - DEL 纯空白 + ADD 纯标点（紧邻）→ 折叠为 ADD 标点（空白删除隐藏）
      - 孤立 DEL 纯空白（前后非紧邻 ADD 标点）→ 隐藏（空白非内容）

    正确性：B 侧（修改版）文本重构不受影响（DEL 段本就不参与 B 侧重构）；
    仅 A 侧重构丢失空白符（空白非内容，无实际影响）。
    """
    n = len(raw_diffs)
    if n < 2:
        return raw_diffs
    out = []
    i = 0
    while i < n:
        op, text = raw_diffs[i]
        if op == -1 and text and _is_ws(text):
            if (
                i + 1 < n
                and raw_diffs[i + 1][0] == 1
                and raw_diffs[i + 1][1]
                and _is_punct(raw_diffs[i + 1][1])
            ):
                # 空白删除 + 标点新增 → 折叠为「新增标点」
                out.append((1, raw_diffs[i + 1][1]))
                i += 2
                continue
            # 孤立纯空白删除 → 隐藏
            i += 1
            continue
        out.append((op, text))
        i += 1
    return out


def _coarse_punct_alignment(x: str, y: str) -> list | None:
    """coarse 组标点归因（2026-08-06）。

    大文档段落 LCS 的 coarse 分支（替换组超限，跳过 DMP）在输出整段 DEL+ADD 前，
    先做实词对齐检测：去标点+空白后实词串相同 → 间隙对齐输出细粒度
    "DEL 标点 + EQ 实词 + ADD 标点"，再叠加 W 空白归因折叠 + 相邻合并。
    实词不同（真重写）→ 返回 None（保持段落级 DEL+ADD）。

    与 _resolve_punct_alignment（L3）同构，复用 split_by_sep 间隙对齐逻辑，
    但无需邻接安全检查（coarse 输出是独立的，不与前后 fine 段交错）。
    """
    wx, wy = _strip_sep(x), _strip_sep(y)
    if not wx or wx != wy:
        return None

    def split_by_sep(s: str) -> tuple[list[str], list[str]]:
        gaps = [""]
        chars = []
        for c in s:
            if c in _PUNCT_CHARS or c in _WS_CHARS or c == _SEP:
                gaps[-1] += c
            else:
                chars.append(c)
                gaps.append("")
        return gaps, chars

    gx, cx = split_by_sep(x)
    gy, cy = split_by_sep(y)
    out: list = []
    eq_buf = ""
    for k in range(len(cx)):
        d, a = gx[k], gy[k]
        if d != a:
            if eq_buf:
                out.append((0, eq_buf))
                eq_buf = ""
            out.extend(_align_gap_pair(d, a))
        else:
            eq_buf += d
        eq_buf += cx[k]
    # 尾间隙
    d, a = gx[len(cx)], gy[len(cy)]
    if d != a:
        if eq_buf:
            out.append((0, eq_buf))
            eq_buf = ""
        out.extend(_align_gap_pair(d, a))
    else:
        eq_buf += d
    if eq_buf:
        out.append((0, eq_buf))

    out = _resolve_whitespace(out)
    out = _merge_adjacent(out)
    return out


def _build_segments(raw_diffs: list) -> tuple[list[dict], dict, list]:
    """把 raw_diffs 转为 segments + stats，同时记录 A/B 侧游标区间。

    返回 (segments, stats, cursor_info)：
      cursor_info: list[(seg_index, side, start, end)] — 每个 segment 在
        原文（'a'）或修改版（'b'）中的字符区间（§5.8 diff 偏移映射用）。
      游标与样式附着的不变式：diff 序列（经标点归因/空白归因重写后）仍能
      完整重构出 A/B 两侧原文，故按操作类型累计 a_pos/b_pos 即可得到每个
      segment 的真实源区间。
    """
    segments: list[dict] = []
    stats = {"total": 0, "add": 0, "del": 0, "mod": 0}
    cursor_info: list = []
    change_index = 0
    a_pos = 0
    b_pos = 0
    i = 0

    while i < len(raw_diffs):
        op, text = raw_diffs[i]

        if op == 0:  # EQUAL
            segments.append({
                "text": text, "operation": "none", "origin": "original",
            })
            cursor_info.append(
                (len(segments) - 1, "a", a_pos, a_pos + len(text))
            )
            a_pos += len(text)
            b_pos += len(text)
            i += 1
            continue

        if op == 1:  # INSERT
            if i + 1 < len(raw_diffs) and raw_diffs[i + 1][0] == -1:
                add_text = text
                del_text = raw_diffs[i + 1][1]
                change_index += 1
                segments.append({
                    "text": del_text, "operation": "mod", "origin": "original",
                    "side": "old", "ci": change_index,
                })
                cursor_info.append(
                    (len(segments) - 1, "a", a_pos, a_pos + len(del_text))
                )
                segments.append({
                    "text": add_text, "operation": "mod", "origin": "original",
                    "side": "new", "ci": change_index,
                })
                cursor_info.append(
                    (len(segments) - 1, "b", b_pos, b_pos + len(add_text))
                )
                stats["mod"] += 1
                stats["total"] += 1
                a_pos += len(del_text)
                b_pos += len(add_text)
                i += 2
                continue
            else:
                change_index += 1
                segments.append({
                    "text": text, "operation": "add", "origin": "original",
                    "ci": change_index,
                })
                cursor_info.append(
                    (len(segments) - 1, "b", b_pos, b_pos + len(text))
                )
                stats["add"] += 1
                stats["total"] += 1
                b_pos += len(text)
                i += 1
                continue

        if op == -1:  # DELETE
            if i + 1 < len(raw_diffs) and raw_diffs[i + 1][0] == 1:
                del_text = text
                add_text = raw_diffs[i + 1][1]
                change_index += 1
                segments.append({
                    "text": del_text, "operation": "mod", "origin": "original",
                    "side": "old", "ci": change_index,
                })
                cursor_info.append(
                    (len(segments) - 1, "a", a_pos, a_pos + len(del_text))
                )
                segments.append({
                    "text": add_text, "operation": "mod", "origin": "original",
                    "side": "new", "ci": change_index,
                })
                cursor_info.append(
                    (len(segments) - 1, "b", b_pos, b_pos + len(add_text))
                )
                stats["mod"] += 1
                stats["total"] += 1
                a_pos += len(del_text)
                b_pos += len(add_text)
                i += 2
                continue
            else:
                change_index += 1
                segments.append({
                    "text": text, "operation": "del", "origin": "original",
                    "ci": change_index,
                })
                cursor_info.append(
                    (len(segments) - 1, "a", a_pos, a_pos + len(text))
                )
                stats["del"] += 1
                stats["total"] += 1
                a_pos += len(text)
                i += 1
                continue

    return segments, stats, cursor_info


def diff_texts(orig: str, modified: str) -> tuple[list[dict], dict]:
    """字符级 diff，返回合并后的 segments 和统计信息。"""
    return diff_texts_with_style(orig, modified)


def _split_keep(text: str, sep: str) -> list:
    """按 sep 切分且保留 sep 在段尾（最后一段除外）。"""
    parts = text.split(sep)
    out = []
    for p in parts[:-1]:
        out.append(p + sep)
    if parts:
        out.append(parts[-1])
    return out


def _diff_fine_group(dmp, d_text: str, a_text: str) -> list:
    """替换组内字符级 diff + 标点归因防线（与全局路径语义完全一致）。"""
    d = dmp.diff_main(d_text, a_text)
    dmp.diff_cleanupSemantic(d)
    d = _resolve_punct_transposition(d)
    d = _resolve_punct_substring(d)
    d = _resolve_punct_alignment(d)
    d = _resolve_whitespace(d)
    return d


def diff_texts_para_lcs(
    orig: str,
    modified: str,
    spans_a: list | None = None,
    spans_b: list | None = None,
) -> tuple[list[dict], dict]:
    """大文档段落级 LCS diff（v7 方案落地，2026-08-06）。

    流水线：split_keep 切段（保留 U+2029 段尾）→ 双哈希（原文 + 归一化）
    → 段落级完整 DP LCS（**归一化哈希 eq**：剥离标点/空白/U+2029 后相同即对齐，
    方案 B 2026-08-07——只差标点/空白/段落分隔符的段不再进替换组）
    → 回溯对齐 → 替换组限长（总长 ≤4096 或单对 ≤2048 做组内字符级 DMP，
    超限 coarse 分支先尝试标点归因兜底，实词相同则间隙对齐输出细粒度，
    实词不同则退化为段落级 DEL+ADD）→ eq 段对原文不同 → 间隙对齐细粒度化
    → 全量 merge → 重建校验 → _build_segments + _attach_spans。

    正确性保证：
      - 段落对齐基于归一化哈希（仅标点/空白/U+2029 差异的段也 eq），
        LCS 保证覆盖全文；eq 段对原文不同时做段对间隙对齐（回退 DMP），
        输出 raw_diffs 仍能精确重构 A/B 两侧（数学等价，无信息丢失）；
      - 输出 raw_diffs 与全局路径同构（eq/del/add 三元组 + mod 由
        _build_segments 合成），前端渲染/编辑/autosave 零改动；
      - 重建校验：B 侧严格相等；A 侧允许空白差异（W 归因隐藏孤立空白）。
    """
    pa = _split_keep(orig, _SEP)
    pb = _split_keep(modified, _SEP)
    # 双哈希（方案 B）：原文精确哈希 + 归一化哈希（_strip_sep 剥离标点/空白/U+2029）
    ha_raw = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pa]
    hb_raw = [hashlib.md5(p.encode("utf-8")).hexdigest() for p in pb]
    ha_norm = [hashlib.md5(_strip_sep(p).encode("utf-8")).hexdigest() for p in pa]
    hb_norm = [hashlib.md5(_strip_sep(p).encode("utf-8")).hexdigest() for p in pb]

    n, m = len(pa), len(pb)
    if n * m > _PARA_LCS_MAX_CELLS:
        raise ValueError(f"para LCS matrix too large: {n}x{m}")

    # ── 段落级完整 DP LCS（归一化哈希 eq）──
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n):
        hi = ha_norm[i]
        row = dp[i]
        nrow = dp[i + 1]
        for j in range(m):
            if hi == hb_norm[j]:
                nrow[j + 1] = row[j] + 1
            else:
                nrow[j + 1] = max(row[j + 1], nrow[j])

    # ── 回溯对齐（归一化哈希）──
    align = []
    i, j = n, m
    while i > 0 and j > 0:
        if ha_norm[i - 1] == hb_norm[j - 1]:
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

    # ── 组装：eq 原样（原文不同 → 段对间隙对齐）；连续 del/add 组成替换组 ──
    dmp = diff_match_patch()
    dmp.Diff_Timeout = _DMP_FINE_TIMEOUT
    raw_parts: list = []
    del_buf: list = []
    add_buf: list = []

    def flush_pair():
        nonlocal del_buf, add_buf
        if not del_buf and not add_buf:
            return
        d_text = "".join(del_buf)
        a_text = "".join(add_buf)
        d_len, a_len = len(d_text), len(a_text)
        if (d_len + a_len) <= _REGION_DMP_MAX:
            raw_parts.extend(_diff_fine_group(dmp, d_text, a_text))
        elif (
            len(del_buf) == 1 and len(add_buf) == 1
            and (d_len + a_len) <= _PAIR_DMP_MAX
        ):
            raw_parts.extend(_diff_fine_group(dmp, d_text, a_text))
        else:
            # coarse：先尝试标点归因（实词相同 → 间隙对齐），失败则段落级展示
            rebuilt = _coarse_punct_alignment(d_text, a_text)
            if rebuilt is not None:
                raw_parts.extend(rebuilt)
            else:
                if d_text:
                    raw_parts.append((-1, d_text))
                if a_text:
                    raw_parts.append((1, a_text))
        del_buf = []
        add_buf = []

    for item in align:
        if item[0] == "eq":
            flush_pair()
            ai, bi = item[1], item[2]
            if ha_raw[ai] == hb_raw[bi]:
                # 原文精确相同 → 原样 EQ
                raw_parts.append((0, pa[ai]))
            else:
                # 归一化对齐但原文不同（仅标点/空白/U+2029 差异）→ 段对间隙对齐
                # （方案 B 实验结论：间隙对齐比段内 DMP 快 4.5 倍、mod 更少、0 失败）
                rebuilt = _coarse_punct_alignment(pa[ai], pb[bi])
                if rebuilt is not None:
                    raw_parts.extend(rebuilt)
                else:
                    # 兜底：段对字符级 DMP（含标点归因防线），保证不丢信息
                    raw_parts.extend(_diff_fine_group(dmp, pa[ai], pb[bi]))
        elif item[0] == "del":
            del_buf.append(pa[item[1]])
        else:
            add_buf.append(pb[item[1]])
    flush_pair()

    raw_diffs = _merge_adjacent(raw_parts)

    # ── 重建校验：B 严格相等；A 允许空白差异（W 隐藏孤立空白）──
    rebuilt_a = "".join(t for op, t in raw_diffs if op in (0, -1))
    rebuilt_b = "".join(t for op, t in raw_diffs if op in (0, 1))
    if rebuilt_b != modified or _strip_ws(rebuilt_a) != _strip_ws(orig):
        raise ValueError("para LCS rebuild mismatch — fallback to global DMP")

    segments, stats, cursor_info = _build_segments(raw_diffs)
    _attach_spans(segments, cursor_info, spans_a, spans_b)
    return segments, stats


def diff_texts_with_style(
    orig: str,
    modified: str,
    spans_a: list | None = None,
    spans_b: list | None = None,
) -> tuple[list[dict], dict]:
    """字符级 diff + StyleSpan 附着（§5.8）。

    与 diff_texts 相同语义，额外按 A/B 游标把解析器的 StyleSpan 切分附着到
    segment（style 可选字段，非 IDML 文件 spans 为 None → 零开销）。
    侧归属（§6.1）：none 段取 A 侧样式（以原文件为准）；add 段取 B 侧；
    del/mod-old 取 A 侧；mod-new 取 B 侧。
    """
    # 大文档自动切换段落 LCS 路径（v7 已验证）；失败回退全局 DMP（慢但正确）
    if max(len(orig), len(modified)) >= _LARGE_DOC_THRESHOLD:
        try:
            return diff_texts_para_lcs(orig, modified, spans_a, spans_b)
        except (ValueError, MemoryError):
            pass

    dmp = diff_match_patch()
    dmp.Diff_Timeout = 0
    raw_diffs = dmp.diff_main(orig, modified)
    dmp.diff_cleanupSemantic(raw_diffs)
    # 标点归因防线 + 空白归因（同 diff_texts，见其注释）
    raw_diffs = _resolve_punct_transposition(raw_diffs)
    raw_diffs = _resolve_punct_substring(raw_diffs)
    raw_diffs = _resolve_punct_alignment(raw_diffs)
    raw_diffs = _resolve_whitespace(raw_diffs)
    raw_diffs = _merge_adjacent(raw_diffs)

    segments, stats, cursor_info = _build_segments(raw_diffs)
    _attach_spans(segments, cursor_info, spans_a, spans_b)
    return segments, stats


def _span_field(sp, name: str, default=None):
    """读取 span 字段：兼容 StyleSpan 对象与 dict（main.py 传 dict 序列化）。"""
    return sp[name] if isinstance(sp, dict) else getattr(sp, name)


def _slice_spans(spans: list, s: int, e: int, start_idx: int = 0) -> tuple[list, int]:
    """从排序、互不重叠的 spans 中切出 [s, e) 子区间（转目标区间内偏移）。

    返回 (切出的 dict 列表, 新的扫描起始索引)。spans 覆盖全文；
    输入兼容 StyleSpan 对象或 dict（to_dict 序列化），输出统一为 dict。
    指针推进规则：span 完全在区间之前 → 前进；完全在区间内被消费完 → 前进；
    延伸到区间之外（留给后续 diff 段瓜分）→ 停在当前索引。游标单调保证不回退。
    """
    out = []
    idx = start_idx
    n = len(spans)
    while idx < n:
        sp = spans[idx]
        sp_end = _span_field(sp, "end")
        sp_start = _span_field(sp, "start")
        if sp_end <= s:
            idx += 1
            continue
        if sp_start >= e:
            break
        ss = max(sp_start, s)
        ee = min(sp_end, e)
        if ee > ss:
            d = sp if isinstance(sp, dict) else sp.to_dict()
            out.append({**d, "start": ss - s, "end": ee - s})
        if sp_end <= e:
            idx += 1  # 该 span 已被完全消费 → 前进
        else:
            break     # 该 span 延伸到区间外，留给后续区间 → 停在当前
    return out, idx


def _attach_spans(
    segments: list[dict],
    cursor_info: list,
    spans_a: list | None,
    spans_b: list | None,
) -> None:
    """按游标区间把 StyleSpan 切分附着到 segments['style']（§5.8）。

    A/B 侧区间随游标单调递增，两侧各维护一个扫描指针，复杂度 O(n + k)。
    侧归属（§6.1）：none/del/mod-old 取 A 侧，add/mod-new 取 B 侧。
    """
    if not cursor_info or (not spans_a and not spans_b):
        return
    pa = 0
    pb = 0
    for seg_idx, side, start, end in cursor_info:
        if end <= start:
            continue
        if side == "a":
            if not spans_a:
                continue
            sliced, pa = _slice_spans(spans_a, start, end, pa)
        else:
            if not spans_b:
                continue
            sliced, pb = _slice_spans(spans_b, start, end, pb)
        if sliced:
            segments[seg_idx]["style"] = sliced


def make_patches(baseline: str, current: str) -> str:
    dmp = diff_match_patch()
    patches = dmp.patch_make(baseline, current)
    return dmp.patch_toText(patches)


def apply_patches(text: str, patches_text: str) -> tuple[str, list[bool]]:
    dmp = diff_match_patch()
    patches = dmp.patch_fromText(patches_text)
    result, statuses = dmp.patch_apply(patches, text)
    return result, statuses
