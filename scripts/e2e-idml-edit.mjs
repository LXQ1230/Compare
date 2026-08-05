/**
 * IDML 编辑模式端到端验证（设计方案 §6.2 styleDeco + §6.6 链路 2 草稿恢复）。
 * 流程：上传 7.idml/7mod.idml → 报告页 → 进入编辑模式 →
 *   断言割注小字 styleDeco 存在 → 编辑文本 → 退出（保存草稿）→ 重进恢复 → styleDeco 仍在。
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

/** 进入编辑模式：等待草稿确认弹窗（有则点继续编辑）。 */
async function enterEdit() {
  const editBtn = page.getByRole('button', { name: /编辑/ }).first();
  await editBtn.click({ timeout: 5000 }).catch(() => page.keyboard.press('Control+e'));
  const cont = page.getByRole('button', { name: /继续编辑/ }).first();
  try {
    await cont.waitFor({ state: 'visible', timeout: 3000 });
    await cont.click();
    await sleep(300);
  } catch { /* 无草稿弹窗 */ }
  await page.waitForSelector('.cm-content', { timeout: 10000 });
  await sleep(800);
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', [
    `${FIXTURES}/7.idml`,
    `${FIXTURES}/7mod.idml`,
  ]);
  await page.click('button.start-btn');
  await page.waitForURL(/\/report\//, { timeout: 60000 });
  await page.waitForSelector('.unified-view', { timeout: 30000 });
  check('对比完成', true);

  // 首次进入编辑模式
  await enterEdit();
  const editable = await page.evaluate(() => {
    const el = document.querySelector('.cm-content');
    return el ? el.getAttribute('contenteditable') : 'missing';
  });
  check('进入编辑模式（可编辑）', editable === 'true', `contenteditable=${editable}`);

  // styleDeco：割注小字号（28×40% = 11.2pt）
  const styleDeco = await page.evaluate(() => {
    const marks = document.querySelectorAll('.cm-content [style*="font-size"]');
    const sizes = new Set();
    marks.forEach((m) => {
      const fs = (m.getAttribute('style') || '').match(/font-size:([\d.]+)pt/);
      if (fs) sizes.add(fs[1]);
    });
    return { count: marks.length, sizes: [...sizes].slice(0, 5) };
  });
  check('styleDeco 割注小字存在', styleDeco.count > 0, JSON.stringify(styleDeco));

  // 编辑：在开头插入一段文本（有实际编辑）
  await page.click('.cm-content');
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('新插入標題。');
  await sleep(400); // 防抖分类
  const hasEdits = await page.evaluate(() => {
    const root = document.querySelector('.cm-content');
    return root ? root.textContent.includes('新插入標題') : false;
  });
  check('编辑生效（插入文本可见）', hasEdits);

  // 退出编辑（触发 exitEdit 保存草稿）
  await page.keyboard.press('Control+e').catch(() => {});
  // 等防抖保存完成
  await sleep(2600);

  // 重新进入编辑模式 → 应恢复草稿（styleDeco 仍在）
  await enterEdit();
  const resumed = await page.evaluate(() => {
    const root = document.querySelector('.cm-content');
    const marks = document.querySelectorAll('.cm-content [style*="font-size"]');
    return {
      hasInserted: root ? root.textContent.includes('新插入標題') : false,
      styleDecoCount: marks.length,
    };
  });
  check('草稿恢复：插入文本保留', resumed.hasInserted);
  check('草稿恢复：styleDeco 仍在', resumed.styleDecoCount > 0,
    `styleDeco=${resumed.styleDecoCount}`);

  await page.screenshot({ path: `${OUT}/e2e-idml-edit.png` }).catch(() => {});
} catch (e) {
  console.error('E2E ERROR:', e.message);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果: ${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
