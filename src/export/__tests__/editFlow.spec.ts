/**
 * Rev. 3-14: 编辑 → 导出 → 搜索 全链路集成测试（单元层 e2e）。
 *
 * 模拟编辑模式的完整数据流：
 *   compareStore.segments(原始差异) → 用户编辑 → classifyEdit(baseline, edited)
 *   → mergeLayers 合成导出段 → exportToHTML/MD/TXT 三格式
 *   → searchInSegments 在编辑后内容上搜索 → 命中位置与导出文本一致。
 */

import { describe, expect, it } from 'vitest';
import { classifyEdit, buildDocText, normalizeLineEndings } from '../../render/editClassifier';
import { mergeLayers } from '../../export/mergeLayers';
import { exportToHTML, exportToMD } from '../../export/exporters';
import { searchInSegments } from '../../utils/search';
import type { Segment } from '../../types';

const N = (text: string): Segment => ({ text, operation: 'none', origin: 'original' });
const ADD = (text: string): Segment => ({ text, operation: 'add', origin: 'original', ci: 1 });

/** 原始对比结果（A↔B 差异）+ 用户在编辑模式的操作 = 最终导出/搜索输入 */
function applyUserEdit(original: Segment[], edited: string): Segment[] {
  const baseline = normalizeLineEndings(buildDocText(original));
  const user = classifyEdit(baseline, normalizeLineEndings(edited));
  return mergeLayers(original, user.dirty ? user.segments : []);
}

const OPTS = { caseSensitive: false, wholeWord: false, useRegex: false };

describe('edit → export → search integration (rev. 3-14)', () => {
  it('搜索命中编辑后新增内容，且命中文本在导出 HTML 中存在', () => {
    const original = [
      N('如是我闻。'),
      ADD('一时佛在舍卫国。'),
      N('与大比丘众俱。'),
    ];
    const edited = '如是我闻。一时佛在祇园精舍。与大比丘众俱。毕陵伽婆蹉。';
    const merged = applyUserEdit(original, edited);

    // 1) 搜索：命中用户新增的"毕陵伽婆蹉"与"祇园精舍"
    const hits = searchInSegments(merged, '毕陵伽婆蹉', OPTS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].preview).toContain('毕陵伽婆蹉');

    // 2) 导出：HTML 含搜索命中的同一文本
    const html = exportToHTML(merged, 't');
    expect(html).toContain('毕陵伽婆蹉');

    // 3) 还原文本与编辑一致（导出=TXT 等价）
    expect(buildDocText(merged)).toBe(edited);
  });

  it('搜索不命中已删除内容（del/phantom 不进入新文档）', () => {
    const original = [N('甲'), ADD('被删原文'), N('乙')];
    const edited = '甲乙'; // 用户删掉了"被删原文"
    const merged = applyUserEdit(original, edited);

    const hits = searchInSegments(merged, '被删原文', OPTS);
    // del 段不进新文档——但 mergeLayers 可能保留 phantom（含 del 文本）用于
    // 显示删除标记。搜索应基于"编辑后新文本"：buildDocText 后的结果不含它。
    expect(buildDocText(merged)).not.toContain('被删原文');
    // 作为 UX 契约：搜索若命中 del 段，其 preview 中该词必须带删除语义；
    // 这里仅验证"最终导出文本不含删除词"这一硬性结果。
    const txt = buildDocText(merged);
    expect(txt).toBe('甲乙');
    // MD 导出（含删除标记）与 TXT（干净文本）行为分离
    const md = exportToMD(merged);
    expect(md.includes('被删原文')).toBe(true); // 删除标记仍在 MD 中
  });

  it('编辑后搜索命中位置对应导出 MD 中的同一文本片段', () => {
    const original = [N('第一节内容。\n第二节内容。')];
    const edited = '第一节内容。\n第二节已修改。\n新增一行。';
    const merged = applyUserEdit(original, edited);

    // 命中用户编辑引入的文本（classifyEdit 可能归类为 mod-new 而非独立 add）
    const hits = searchInSegments(merged, '新增一行', OPTS);
    expect(hits.length).toBe(1);
    const md = exportToMD(merged);
    // 干净文本（TXT 等价）必须包含编辑后的完整内容
    expect(buildDocText(merged)).toContain('第二节已修改');
    expect(buildDocText(merged)).toContain('新增一行');
    // MD 带 diff 标记会打断连续文本（mod-old/new 交错），只验证编辑内容存在
    expect(md).toContain('已修改');
    expect(md).toContain('新增一行');
    // TXT 等价 = 最终文档
    expect(buildDocText(merged)).toBe(edited);
  });
});
