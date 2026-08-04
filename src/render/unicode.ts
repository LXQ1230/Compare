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
 */
function protectAstral(
  text: string,
  sharedUsed: Set<number>,
): { text: string; map: Map<string, string> } {
  if (!HIGH_SURROGATE_RE.test(text)) {
    return { text, map: new Map() };
  }
  const map = new Map<string, string>();
  let out = "";
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      // 分配未使用的私有区码位（U+E000–U+F8FF）
      let ph = "\uE000";
      for (let c = 0xe000; c <= 0xf8ff; c++) {
        if (!sharedUsed.has(c)) {
          sharedUsed.add(c);
          ph = String.fromCharCode(c);
          break;
        }
      }
      map.set(ph, ch);
      out += ph;
    } else {
      out += ch;
    }
  }
  return { text: out, map };
}

function restoreAstral(text: string, map: Map<string, string>): string {
  return text.replace(/[\uE000-\uF8FF]/g, (ph) => map.get(ph) ?? ph);
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
  const raw = dmp.diff_main(pa.text, pb.text);
  dmp.diff_cleanupSemantic(raw);

  if (pa.map.size === 0 && pb.map.size === 0) return raw as [number, string][];
  const combined = new Map<string, string>([...pa.map, ...pb.map]);
  return raw.map(([op, t]) => [op, restoreAstral(t, combined)]) as [number, string][];
}
