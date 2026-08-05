/**
 * IDML 支持端到端验证（设计方案 §9 测试策略 4：渲染对照）。
 * 流程：上传 7.idml / 7mod.idml → 对比 → 报告页查看模式。
 * 断言：竖排容器（writing-mode:vertical-rl）、割注双列（.warichu-*）、
 *       段落分隔（.para-break）、修改点标记（seg-mod-*）+ 样式附着。
 * 截图：e2e-idml-unified.png / e2e-idml-split.png
 */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5173';
const FIXTURES = 'D:/Desktop/Compare/fixtures';
const OUT = 'D:/Desktop/Compare';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('打开首页', await page.getByText('文档对比工具').isVisible());

  await page.setInputFiles('input[type=file]', [
    `${FIXTURES}/7.idml`,
    `${FIXTURES}/7mod.idml`,
  ]);
  await sleep(300);
  check('上传 7.idml + 7mod.idml',
    await page.getByText('7.idml').isVisible() && await page.getByText('7mod.idml').isVisible());

  await page.click('button.start-btn');
  await page.waitForURL(/\/report\//, { timeout: 60000 });
  check('对比完成并跳转 /report/:sessionId', true, page.url());

  // 等待 segments 渲染完成（unified-view 出现且非空）
  await page.waitForSelector('.unified-view', { timeout: 30000 });
  await sleep(1200);

  // 1) 竖排容器
  const vertical = await page.evaluate(() => {
    const el = document.querySelector('.unified-view');
    return el ? getComputedStyle(el).writingMode : 'missing';
  });
  check('竖排容器 writing-mode: vertical-rl', vertical === 'vertical-rl', `got ${vertical}`);

  // 2) 割注双列结构
  const warichu = await page.evaluate(() => {
    const w = document.querySelectorAll('.unified-view .warichu');
    const pairs = document.querySelectorAll('.unified-view .warichu-pair');
    const cols = document.querySelectorAll('.unified-view .warichu-col');
    return { groups: w.length, pairs: pairs.length, cols: cols.length };
  });
  check('割注结构存在（warichu-pair/col）',
    warichu.groups > 0 && warichu.pairs > 0 && warichu.cols > 0,
    JSON.stringify(warichu));

  // 3) 段落分隔 .para-break
  const breaks = await page.evaluate(() =>
    document.querySelectorAll('.unified-view .para-break').length);
  check('段落分隔 .para-break 存在', breaks > 50, `count=${breaks}`);

  // 4) 修改点（mod 段）+ 样式
  const mod = await page.evaluate(() => {
    const marks = document.querySelectorAll('.unified-view mark[data-ci]');
    return { total: marks.length, hasStyle: !!document.querySelector('.unified-view mark span[style*="font-family"], .unified-view span[style*="font-family"]') };
  });
  check('修改点标记存在', mod.total > 0, `ci count=${mod.total}`);
  check('字符样式 span 已渲染', mod.hasStyle);

  // 5) 修改内容：Unified 视图同时渲染 mod old/new（textContent 含"四""五"相连）
  const body = await page.evaluate(() =>
    document.querySelector('.unified-view')?.textContent ?? '');
  check('B 侧修改文本可见（淨土四→五 mod 对）', body.includes('淨土四五'),
    'mod old/new 均已渲染');
  check('B 侧修改文本可见（魏默深改）', body.includes('魏默深改'));

  await page.screenshot({ path: `${OUT}/e2e-idml-unified.png`, fullPage: false });

  // 6) Split 视图
  const splitBtn = page.getByRole('button', { name: /分栏|split|Split/i }).first();
  const hasSplitBtn = await splitBtn.isVisible().catch(() => false);
  if (hasSplitBtn) {
    await splitBtn.click();
    await sleep(800);
    await page.waitForSelector('.split-pane', { timeout: 10000 });
    const splitVertical = await page.evaluate(() => {
      const el = document.querySelector('.split-pane');
      return el ? getComputedStyle(el).writingMode : 'missing';
    });
    check('Split 视图竖排', splitVertical === 'vertical-rl', `got ${splitVertical}`);
    await page.screenshot({ path: `${OUT}/e2e-idml-split.png`, fullPage: false });
  } else {
    check('Split 视图按钮', false, '未找到切换按钮');
  }
} catch (e) {
  console.error('E2E ERROR:', e.message);
  await page.screenshot({ path: `${OUT}/e2e-idml-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
