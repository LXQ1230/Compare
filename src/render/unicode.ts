/**
 * Unicode 处理工具（三期 B 组：4-4 / 4-5 / 4-6 / 4-7）。
 *
 * - normalizeText: 剥离首部 BOM + 换行归一(LF) + NFC 规范化
 * - normalizeFullwidth: 全角标点 → 半角（用户偏好开关，默认关）
 * - diffSafely: DMP 的 surrogate 安全封装——非 BMP 字符在 diff 前映射到
 *   BMP 私有区单 unit 占位，diff 完成后逐段还原，杜绝 DMP 把 UTF-16
 *   surrogate pair 拆成两个独立 unit 导致的 diff 错位。
 *
 * 一致性约定：normalizeText 只用于「进入编辑模式时的基线/doc 初始化」
 * （enterEdit / ensureEditor / discardDraft），classifyEdit 运行期输入即
 * 输出、不做运行时规范化——否则 segments 文本与编辑器 doc 长度不一致，
 * 基于 text.length 的装饰偏移会错位（CodeMirrorDiff buildDecoSet 按长度累加）。
 */

import { diff_match_patch } from "diff-match-patch";

// ── BOM / 换行 / NFC ─────────────────────────────────────────────

/** 剥离首部 BOM（\uFEFF 是文件编码标记，不是文档内容）。 */
export function stripBOM(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 换行归一（CRLF/CR → LF），与 CodeMirror 的文档分割一致。 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * 统一规范化：BOM 剥离 + LF + NFC。
 * NFC 对中文无影响（无组合字符），只规范化拉丁组合字符（é = e+◌́ → é），
 * 保证「文件原文」与「编辑器 doc」在初始化时字符一致。
 */
export function normalizeText(text: string): string {
  return normalizeLineEndings(stripBOM(text)).normalize("NFC");
}

// ── 全角 → 半角（4-7，可选开关，默认关）─────────────────────────

/** 常见全角标点 → 半角。佛经等 CJK 文档中全角标点是正式内容，默认不归一。 */
const FULLWIDTH_MAP: Record<string, string> = {
  "，": ",", "。": ".", "！": "!", "？": "?", "；": ";", "：": ":",
  "（": "(", "）": ")", "【": "[", "】": "]", "｛": "{", "｝": "}",
  "“": '"', "”": '"', "‘": "'", "’": "'",
};

export function normalizeFullwidth(text: string): string {
  let out = "";
  for (const ch of text) {
    out += FULLWIDTH_MAP[ch] ?? ch;
  }
  return out;
}

// ── surrogate 安全 diff（4-4）───────────────────────────────────

const HIGH_SURROGATE_RE = /[\uD800-\uDFFF]/;

/**
 * 将非 BMP 字符（surrogate pair，2 个 UTF-16 unit）映射为 BMP 私有区
 * 单 unit 占位符。sharedUsed 跨两个输入共享，保证同一字符在同一会话内
 * 得到同一占位符（DMP 的 equal 段还原一致）。
 * 快路径：文本无 surrogate 时原样返回（高频编辑场景零开销）。
 * 方案 P2-8: 私有区 U+E000–U+F8FF 共 6400 个码位，显式检测耗尽——
 * overflow=true 时调用方回退无保护 diff（文本不损坏，仅 diff 粒度可能变粗）。
 */
function protectAstral(
  text: string,
  sharedUsed: Set<number>,
): { text: string; map: Map<string, string>; overflow: boolean } {
  if (!HIGH_SURROGATE_RE.test(text)) {
    return { text, map: new Map(), overflow: false };
  }
  const map = new Map<string, string>();
  let out = "";
  let overflow = false;
  let next = 0xe000;
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      while (sharedUsed.has(next)) next++;
      if (next > 0xf8ff) {
        // 占位符耗尽 → 立即回退（本次调用即弃，无副作用）
        overflow = true;
        break;
      }
      sharedUsed.add(next);
      const ph = String.fromCharCode(next++);
      map.set(ph, ch);
      out += ph;
    } else {
      out += ch;
    }
  }
  return { text: out, map, overflow };
}

function restoreAstral(text: string, map: Map<string, string>): string {
  return text.replace(/[\uE000-\uF8FF]/g, (ph) => map.get(ph) ?? ph);
}

// ── 标点移动优先重写（2026-08-04 用户实测）─────────────────────────

/** 标点字符集（中文标点 + 英文标点）。 */
const PUNCT_CHARS = new Set(
  "。！？；：，、…—～「」『』（）《》〈〉【】〔〕｛｝,.;:!?…—~\"'()[]{}",
);

/**
 * 空白符集合：换行/制表/全角空格/Unicode 空格/BOM。
 * 空白符是排版符号而非内容——句读编辑中「行尾回车/空格 → 标点」是常规操作，
 * 空白符的增删不应单独标记（用户实测 2026-08-05：Word 句读结果大量出现）。
 */
const WS_CHARS = new Set(
  "\n\r\t\u3000"
  + "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
  + "\u00a0\u202f\u205f\ufeff "
);

/** 交换检测间隔上限：del X 与 add X 之间标点间隔超过此长度则视为独立操作。 */
const PUNCT_TRANSPOSE_GAP_LIMIT = 8;

/**
 * 标点移动优先：把「del X + (短标点间隔) + add X」重写为「add 标点 + X + del 标点」。
 *
 * 背景：原文「舎衛國。在」改为「舎衛。國在」——DMP 的最小编辑有两种等价解释：
 *   A) 移动实词：del '國' + keep '。' + add '國'   （DMP 默认）
 *   B) 移动标点：add '。' + keep '國' + del '。'   （用户实际做的：句号前移）
 * 两种解释的 A/B 两侧文本重构完全一致（数学等价），仅"哪个字符被视为移动"
 * 的语义不同。佛经句读场景中「修正标点位置」远多于「移动实词」，故优先选 B。
 *
 * 规则：仅当 X 非空、间隔 Y 非空且全部为标点、间隔 ≤ gap_limit 时重写，
 * 防止把相距很远的「真删除 X + 真新增 X」误判为交换。
 * 与后端 diff_engine._resolve_punct_transposition 逻辑一致。
 */
export function resolvePunctTransposition(raw: [number, string][]): [number, string][] {
  const n = raw.length;
  if (n < 3) return raw;
  const out: [number, string][] = [];
  let i = 0;
  while (i < n) {
    const [op, text] = raw[i];
    if (
      op === -1 && text
      && i + 2 < n
      && raw[i + 1][0] === 0
      && raw[i + 2][0] === 1
      && raw[i + 2][1] === text
    ) {
      const gap = raw[i + 1][1];
      if (gap.length > 0 && gap.length <= PUNCT_TRANSPOSE_GAP_LIMIT && Array.from(gap).every((c) => PUNCT_CHARS.has(c))) {
        out.push([1, gap], [0, text], [-1, gap]);
        i += 3;
        continue;
      }
    }
    out.push([op, text]);
    i++;
  }
  return out;
}

/**
 * 标点包裹优先（L2，2026-08-05 用户实测）：把「del X + add Y」
 * （X⊂Y 或 Y⊂X，两侧纯标点）重写为「add 标点 + X + add 标点」
 * 或「del 标点 + Y + del 标点」。
 *
 * 背景：原文「我聞如是」改为「我。聞。如是。」——DMP 输出
 * del '聞' + add '。聞。'，把实词'聞'标成替换；用户实际只是加标点。
 * 佛经句读场景中「加/删标点」远多于「替换实词」，故优先把变更归因于标点。
 * 与 resolvePunctTransposition 同族（标点归因 L1），属第二层：
 *
 *   - X⊂Y（Y=P+X+Q）：重写为 add P + X + add Q   （插入标点）
 *   - Y⊂X（X=P+Y+Q）：重写为 del P + Y + del Q   （删除标点）
 *
 * 仅当 P、Q 均为纯标点（可为空、至少一侧非空）时重写；
 * 两侧含汉字（真替换，如'。見聞。'）则不重写，保持 DMP 原样。
 * 与后端 diff_engine._resolve_punct_substring 逻辑一致。
 */
export function resolvePunctSubstring(raw: [number, string][]): [number, string][] {
  const n = raw.length;
  if (n < 2) return raw;
  const out: [number, string][] = [];
  let i = 0;
  while (i < n) {
    const [op, text] = raw[i];
    if (
      op === -1 && text
      && i + 1 < n
      && raw[i + 1][0] === 1
      && raw[i + 1][1]
    ) {
      const x = text;
      const y = raw[i + 1][1];
      // 插入方向：Y = P + X + Q
      let idx = y.indexOf(x);
      if (idx !== -1) {
        const p = y.slice(0, idx);
        const q = y.slice(idx + x.length);
        if ((p || q) && Array.from(p).every((c) => PUNCT_CHARS.has(c)) && Array.from(q).every((c) => PUNCT_CHARS.has(c))) {
          if (p) out.push([1, p]);
          out.push([0, x]);
          if (q) out.push([1, q]);
          i += 2;
          continue;
        }
      }
      // 删除方向：X = P + Y + Q
      idx = x.indexOf(y);
      if (idx !== -1) {
        const p = x.slice(0, idx);
        const q = x.slice(idx + y.length);
        if ((p || q) && Array.from(p).every((c) => PUNCT_CHARS.has(c)) && Array.from(q).every((c) => PUNCT_CHARS.has(c))) {
          if (p) out.push([-1, p]);
          out.push([0, y]);
          if (q) out.push([-1, q]);
          i += 2;
          continue;
        }
      }
    }
    out.push([op, text]);
    i++;
  }
  return out;
}

/**
 * 实词对齐兜底（L3）：把「del X + add Y」中去标点后实词串相同的对，
 * 强制按标点归因重写。这是标点归因三层的最后防线：
 * 只要用户未改实词（去标点后实词串一致），无论 DMP 怎么切，
 * 变更都归因于标点。
 *
 * 实现（间隙对齐）：把 X、Y 各自的标点分段对齐到共同实词串 W 的 n+1 个
 * 间隙，按「间隙0 + w1 + 间隙1 + ... + wk + 间隙k」交错输出：
 * del X侧标点 + W + add Y侧标点。标点保留在各自侧原始相对位置，
 * 两侧文本重组后与原始 A/B 完全一致（数学等价，无信息丢失）。
 *
 * 边界：
 *   - 同一间隙两侧都有标点且不同 = 标点替换 → 保持 del+add（mod 语义正确）
 *   - 两侧全为标点（无实词可对齐）或实词不同 → 不重写
 *   - 重写后首/尾操作与前后操作相邻形成 del/add 邻接（会被分段合成 mod）
 *     → 放弃重写（保守，保持 DMP 原样）
 * 与后端 diff_engine._resolve_punct_alignment 逻辑一致。
 */
export function resolvePunctAlignment(raw: [number, string][]): [number, string][] {
  const n = raw.length;
  if (n < 2) return raw;

  const splitBySep = (s: string): { gaps: string[]; chars: string[] } => {
    // 标点与空白都视为分隔符：gaps[k] 为第 k 个实词前的分隔符段
    const gaps = [""];
    const chars: string[] = [];
    for (const c of s) {
      if (PUNCT_CHARS.has(c) || WS_CHARS.has(c)) {
        gaps[gaps.length - 1] += c;
      } else {
        chars.push(c);
        gaps.push("");
      }
    }
    return { gaps, chars };
  };

  const stripSep = (s: string) =>
    Array.from(s).filter((c) => !PUNCT_CHARS.has(c) && !WS_CHARS.has(c)).join("");

  const out: [number, string][] = [];
  let i = 0;
  while (i < n) {
    const [op, text] = raw[i];
    if (
      op === -1 && text
      && i + 1 < n
      && raw[i + 1][0] === 1
      && raw[i + 1][1]
    ) {
      const x = text;
      const y = raw[i + 1][1];
      const wx = stripSep(x);
      const wy = stripSep(y);
      if (x !== y && wx && wx === wy) {
        const { gaps: gx, chars: cx } = splitBySep(x);
        const { gaps: gy, chars: cy } = splitBySep(y);
        if (cx.join("") === cy.join("")) {
          const rebuilt: [number, string][] = [];
          for (let k = 0; k < cx.length; k++) {
            if (gx[k]) rebuilt.push([-1, gx[k]]);
            if (gy[k]) rebuilt.push([1, gy[k]]);
            rebuilt.push([0, cx[k]]);
          }
          if (gx[cx.length]) rebuilt.push([-1, gx[cx.length]]);
          if (gy[cy.length]) rebuilt.push([1, gy[cy.length]]);
          // 邻接安全检查：防止重写后的 del/add 与前后操作相邻被合成 mod
          let safe = true;
          if (rebuilt.length > 0) {
            const firstOp = rebuilt[0][0];
            const lastOp = rebuilt[rebuilt.length - 1][0];
            const prevOp = out.length > 0 ? out[out.length - 1][0] : null;
            const nxtOp = i + 2 < n ? raw[i + 2][0] : null;
            if ((prevOp === 1 && firstOp === -1) || (prevOp === -1 && firstOp === 1)) safe = false;
            if ((nxtOp === 1 && lastOp === -1) || (nxtOp === -1 && lastOp === 1)) safe = false;
          }
          if (safe) {
            out.push(...rebuilt);
            i += 2;
            continue;
          }
        }
      }
    }
    out.push([op, text]);
    i++;
  }
  return out;
}

/**
 * 空白归因（W，2026-08-05 用户实测）：空白符是排版符号而非内容。
 *
 * 背景：Word 句读结果把「行尾回车/全角空格 → 标点」作为常规操作——
 * 原「道祖筆受\n」改「道祖筆受。」，DMP 输出 del '\n' + add '。' 标成 mod，
 * 用户期望只显示「受」后新增「。」，回车符的删除不应单独标记。
 *
 * 规则：
 *   - del 纯空白 + add 纯标点（紧邻）→ 折叠为 add 标点（空白删除隐藏）
 *   - 孤立 del 纯空白（前后非紧邻 add 标点）→ 隐藏（空白非内容）
 *
 * 正确性：B 侧（修改版）文本重构不受影响（del 段本就不参与 B 侧重构）。
 * 与后端 diff_engine._resolve_whitespace 逻辑一致。
 */
export function resolveWhitespace(raw: [number, string][]): [number, string][] {
  const n = raw.length;
  if (n < 2) return raw;
  const out: [number, string][] = [];
  let i = 0;
  while (i < n) {
    const [op, text] = raw[i];
    if (op === -1 && text && Array.from(text).every((c) => WS_CHARS.has(c))) {
      if (
        i + 1 < n
        && raw[i + 1][0] === 1
        && raw[i + 1][1]
        && Array.from(raw[i + 1][1]).every((c) => PUNCT_CHARS.has(c))
      ) {
        // 空白删除 + 标点新增 → 折叠为「新增标点」
        out.push([1, raw[i + 1][1]]);
        i += 2;
        continue;
      }
      // 孤立纯空白删除 → 隐藏
      i += 1;
      continue;
    }
    out.push([op, text]);
    i++;
  }
  return out;
}

/**
 * 合并相邻同类操作（add+add → add），保证重写后输出整洁。
 */
function mergeAdjacent(raw: [number, string][]): [number, string][] {
  const out: [number, string][] = [];
  for (const [op, text] of raw) {
    if (out.length > 0 && out[out.length - 1][0] === op) {
      out[out.length - 1] = [op, out[out.length - 1][1] + text];
    } else {
      out.push([op, text]);
    }
  }
  return out;
}

/**
 * DMP 字符级 diff 的 surrogate 安全封装。
 * 输入两个文本，输出 DMP rawDiffs（[op, text][]，op: 0=equal 1=insert -1=delete）。
 * 非 BMP 字符全程以占位符参与 diff，结果逐段还原为真实字符。
 */
export function diffSafely(baseline: string, edited: string): [number, string][] {
  const sharedUsed = new Set<number>();
  const pa = protectAstral(baseline, sharedUsed);
  const pb = protectAstral(edited, sharedUsed);

  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 0;

  let raw: [number, string][];

  // 方案 P2-8: 占位符耗尽（>6400 个不同非 BMP 字符）→ 回退直接 DMP。
  // astral 可能被拆成 surrogate unit，diff 粒度变粗，但文本完整不损坏。
  if (pa.overflow || pb.overflow) {
    raw = dmp.diff_main(baseline, edited) as [number, string][];
    dmp.diff_cleanupSemantic(raw);
  } else {
    raw = dmp.diff_main(pa.text, pb.text) as [number, string][];
    dmp.diff_cleanupSemantic(raw);
    if (pa.map.size > 0 || pb.map.size > 0) {
      const combined = new Map<string, string>([...pa.map, ...pb.map]);
      raw = raw.map(([op, t]) => [op, restoreAstral(t, combined)]) as [number, string][];
    }
  }

  // 标点归因防线 + 空白归因（佛经句读场景：变更优先归因于标点，空白是排版符）：
  //   L1 标点移动（del X + 短标点间隔 + add X）→ add 标点 + X + del 标点
  //   L2 标点包裹（del X + add(P+X+Q)）→ add P + X + add Q
  //   L3 实词对齐兜底（两侧去标点/空白后实词串相同）→ 强制标点归因
  //   W  空白归因（del 纯空白 + add 纯标点 → add 标点；孤立 del 纯空白 → 隐藏）
  // 与后端 diff_engine.diff_texts 一致。
  let out = resolvePunctTransposition(raw);
  out = resolvePunctSubstring(out);
  out = resolvePunctAlignment(out);
  out = resolveWhitespace(out);
  return mergeAdjacent(out);
}
