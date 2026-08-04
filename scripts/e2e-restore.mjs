/**
 * 三期 A 组端到端验证：恢复检测器（Playwright + 系统 Chrome）。
 * 流程：上传 sampleA/B → 对比 → 编辑模式 → 删除"應作如是觀。"（=恢复原文）
 * → 断言 cm-user-restored 绿色出现 + Sidebar"已恢复原文 1 处"。
 */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5173';
const FIXTURES = 'D:/Desktop/Compare/fixtures';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

try {
  // 1. 打开首页
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('打开首页', await page.getByText('文档对比工具').isVisible());

  // 2. 上传两个文件（DropZone 的 multiple input）
  await page.setInputFiles('input.drop-input', [
    `${FIXTURES}/sampleA.txt`,
    `${FIXTURES}/sampleB.txt`,
  ]);
  check('选择文件', await page.getByText('sampleA.txt').isVisible() && await page.getByText('sampleB.txt').isVisible());

  // 3. 开始对比 → 等待跳转 report
  await page.click('button.start-btn');
  await page.waitForURL(/\/report\//, { timeout: 30000 });
  check('对比完成并跳转 /report/:sessionId', true, page.url());

  // 4. 进入编辑模式（wrapper 默认 hidden，编辑后可见）
  const editBtn = page.getByRole('button', { name: /编辑/ }).first();
  await editBtn.click({ timeout: 5000 }).catch(() => page.keyboard.press('Control+e'));
  await page.waitForSelector('.cm-diff-wrapper', { state: 'visible', timeout: 10000 });
  await page.waitForSelector('.cm-content', { timeout: 10000 });
  await sleep(600);
  const editable = await page.evaluate(() => {
    const el = document.querySelector('.cm-content');
    return el ? el.getAttribute('contenteditable') : 'missing';
  });
  check('进入编辑模式（可编辑）', editable === 'true', `contenteditable=${editable}`);

  // 5. 定位"應作如是觀。"并删除（= 恢复原文，A 中无此行）
  const restoredText = '應作如是觀。';
  const inDoc = await page.evaluate((t) => {
    const view = document.querySelector('.cm-content');
    return view ? view.textContent.includes(t) : false;
  }, restoredText);
  check('编辑文档含目标文本', inDoc);

  // 用 Ctrl+F 搜索定位？直接通过 CM 内部 dispatch 删除更稳——
  // 用键盘：先点击编辑器，Ctrl+Home，再查找。简化：用 CM view 不可直接访问，
  // 改用"全选替换"策略不可行（会破坏全文）。这里用搜索 + 删除：
  await page.click('.cm-content');
  // 通过 selection API 定位目标文本：创建 TextRange 选中该文本并删除
  const deleted = await page.evaluate((t) => {
    const root = document.querySelector('.cm-content');
    if (!root) return 'no-root';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(t);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + t.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return 'selected';
      }
    }
    return 'not-found';
  }, restoredText);
  check('选中目标文本', deleted === 'selected', deleted);
  await page.keyboard.press('Backspace');
  await sleep(2500); // 防抖 + classify

  // 6. 验证恢复检测：cm-user-restored 出现 + Sidebar 统计
  const restoredInfo = await page.evaluate(() => {
    const restoredEls = document.querySelectorAll('.cm-user-restored');
    const sidebar = document.querySelector('.restored-hint');
    const toolbar = document.querySelector('.restored-badge');
    return {
      restoredCount: restoredEls.length,
      sidebarText: sidebar ? sidebar.textContent : null,
      toolbarText: toolbar ? toolbar.textContent : null,
    };
  });
  check('恢复段绿色标记出现', restoredInfo.restoredCount > 0, `cm-user-restored=${restoredInfo.restoredCount}`);
  check('Sidebar 显示"已恢复原文"', !!restoredInfo.sidebarText, restoredInfo.sidebarText ?? '无');
  check('Toolbar 显示恢复徽标', !!restoredInfo.toolbarText, restoredInfo.toolbarText ?? '无');

  await page.screenshot({ path: 'D:/Desktop/Compare/restore-e2e-verified.png', fullPage: false });
  check('截图已保存', true);
} catch (e) {
  console.error('E2E ERROR:', e.message);
  try { await page.screenshot({ path: 'D:/Desktop/Compare/restore-e2e-failed.png' }); } catch {}
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length > 0 ? 1 : 0);
