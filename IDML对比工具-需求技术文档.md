# IDML 文档对比工具 — 需求技术文档

> 生成日期：2026-07-16
> 项目目录：`D:/Desktop/IDML`
> 本文档基于 v4 需求技术文档与 doc-compare TECHNICAL.md 融合生成，所有差异项已逐一确认。

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [模块清单](#3-模块清单)
4. [数据流](#4-数据流)
5. [HTTP API 端点](#5-http-api-端点)
6. [IDML 解析器](#6-idml-解析器)
7. [Diff 引擎](#7-diff-引擎)
8. [数据模型](#8-数据模型)
9. [颜色方案](#9-颜色方案)
10. [PDF 渲染管道](#10-pdf-渲染管道)
11. [界面功能](#11-界面功能)
12. [页面组件树](#12-页面组件树)
13. [跨窗口通信](#13-跨窗口通信)
14. [编辑模式与保存逻辑](#14-编辑模式与保存逻辑)
15. [搜索功能](#15-搜索功能)
16. [错误处理](#16-错误处理)
17. [非功能性需求](#17-非功能性需求)
18. [已知限制](#18-已知限制)
19. [依赖清单](#19-依赖清单)
20. [技术决策记录](#20-技术决策记录)
21. [文件索引](#21-文件索引)
22. [启动与部署](#22-启动与部署)
23. [测试策略](#23-测试策略)

---

## 1. 项目概述

### 1.1 目标

比较两份 Adobe InDesign IDML 文档的文本差异，生成交互式 Web 对比报告，支持：
- 在线编辑文本（三方 Diff 区分原始变更与用户编辑）
- 本地 + 服务端双层自动保存
- 导出包含 diff 标注的 PDF 文档
- IDML 反向写入

### 1.2 核心特性

| 特性 | 说明 |
|------|------|
| **IDML 解析** | Python 服务端流式解析，含正文过滤与字符清洗 |
| **字符级 Diff** | google-diff-match-patch，字符级对比 + 语义清理 |
| **双视图模式** | 统一视图（差异内嵌单一文本流）+ 分栏视图（原文/修改左右对照同步滚动），工具栏一键切换，左侧侧边栏导航 |
| **编辑模式** | 三方 Diff 区分原始变更与用户编辑，8 色可自定义标记体系；进入编辑前自动备份完整对比报告 |
| **导出** | 编辑后多格式导出：IDML、PDF（双层标注）、DOCX（保留排版）、HTML/MD/TXT（纯文本） |
| **双窗口通信** | 选择页 → 报告页 postMessage 通信 |
| **前后端分离** | Vue 3 + TypeScript 前端 / Python 3.13 API 后端 |

### 1.3 范围边界

| 包含 | 不包含 |
|------|--------|
| IDML 文字 + 符号字符级对比 | 图片 / 表格 / 页眉页脚 / 脚注 / 批注 |
| 同格式两两对比 | 跨格式对比 |
| 格式变更检测 | 语义级对比 |
| .doc / .indd / .txt 等其他格式 | 竖排文档 |

### 1.4 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| 前端框架 | Vue 3 (Composition API + `<script setup>`) + TypeScript (strict) | SPA 选择页 + 报告页 |
| 构建工具 | Vite ^5.x | 多页面构建 |
| 后端 HTTP | Python 3.13 + `http.server` | REST API 服务 |
| IDML 解析 | 纯 Python XML 流式解析 | 服务端提取 Story 文本 |
| Diff 引擎 | google-diff-match-patch (Python) | 服务端字符级差异对比 |
| PDF 生成 | Node.js + Playwright (Chromium) + Paged.js | 高质量 A4 PDF 渲染 + CSS Paged Media 分页控制 |
| 字体 | 系统 TTF/OTF 自动检测 | 跨平台中文支持 |
| 跨窗口通信 | postMessage + localStorage | 选择页 ↔ 报告页数据传递 |

---

## 2. 系统架构

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                        浏览器 (Chrome/Edge/Firefox)                    │
│                                                                      │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐   │
│  │    选择页 (index.html)    │    │     报告页 (report.html)      │   │
│  │    Vue 3 SPA              │    │     Vue 3 SPA                │   │
│  │    · 拖拽/路径上传         │    │     · 分栏/统一双视图         │   │
│  │    · 格式校验+进度提示      │    │     · 侧边栏（统计/变更/筛选） │   │
│  │    · Story 结构选择        │    │     · 查看/编辑双模式          │   │
│  │    · 多窗口管理             │    │     · 8色双层 + 4套主题       │   │
│  │    · 开窗跳转              │    │     · 搜索+替换+类型过滤       │   │
│  └──────────┬───────────────┘    │     · 备份+多格式导出+IDML写回  │   │
│             │ postMessage        │     · ⚙️ 设置面板               │   │
│             │                    │     · IndexedDB 分段存储        │   │
│             │                    │     · localStorage 会话管理     │   │
│             └─────────┬──────────┘     └──────────────┬───────────┘   │
│                       │ HTTP :17890 (NDJSON 流式)     │               │
└───────────────────────┼──────────────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────────┐
│                         PYTHON 服务器                                 │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                  idml_gui.py (主控)                               │ │
│  │  · BaseHTTPRequestHandler 单线程                                  │ │
│  │  · 路由: / /report /api/compare /api/backup /api/save_* /download│ │
│  └──┬──────┬─────────┬──────────┬──────────┬──────────┬────────────┘ │
│     │      │         │          │          │          │              │
│  ┌──▼──┐ ┌▼───────┐┌▼────────┐┌▼───────┐┌▼────────┐┌▼──────────┐   │
│  │diff │ │idml    ││idml     ││idml    ││backup   ││config     │   │
│  │engin│ │parser  ││writer   ││pdf     ││manager  ││loader     │   │
│  │e.py │ │.py     ││.py      ││.py     ││.py      ││.py        │   │
│  │     │ │        ││         ││        ││         ││           │   │
│  │字符级│ │流式解析 ││解包→替换 ││Playwr. ││JSON快照  ││.env配置   │   │
│  │永不  │ │字体提取 ││→重新打包 ││+Paged  ││+HTML文件 ││加载       │   │
│  │超时  │ │正文过滤 ││保留全资源││.js     ││         ││           │   │
│  └─────┘ └────────┘└─────────┘└───┬────┘└─────────┘└───────────┘   │
│                                   │ subprocess                       │
│                        ┌──────────▼──────────┐                       │
│                        │   Node.js v22.22.2   │                       │
│                        │  playwright_pdf.cjs   │                       │
│                        │  + playwright         │                       │
│                        │  + Paged.js           │                       │
│                        │  + Chromium 无头      │                       │
│                        └─────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 前后端分离设计

| 端 | 职责 | 技术 |
|----|------|------|
| **前端** | 选择页 UI、报告页双视图/编辑/搜索、跨窗口通信、会话管理、IndexedDB 分段存储、备份管理 | Vue 3 + TypeScript + Vite |
| **后端** | IDML 解析（严格模式+字体提取）、NDJSON 流式 Diff（永不超时）、PDF 生成、autosave、备份、IDML 写回 | Python 3.13 + Node.js Playwright |
| **通信** | REST API（JSON）+ NDJSON 流式 + 文件下载 | HTTP :17890 |

### 2.3 多页面配置

```typescript
// vite.config.ts — 双入口
build: {
  rollupOptions: {
    input: {
      main: resolve(__dirname, 'index.html'),
      report: resolve(__dirname, 'report.html'),
    }
  }
}
```

- 开发：`http://localhost:3000/` + `http://localhost:3000/report.html`
- 选择页 `window.open('report.html')` → postMessage 传递数据
- localStorage 中转大数据 + 刷新恢复

---

## 3. 模块清单

### 3.1 后端核心模块

| 文件 | 职责 | 关键内容 |
|------|------|----------|
| `idml_gui.py` | HTTP 服务器 + 路由编排 | `IDMLServer`, 对比/保存/PDF 流程 |
| `diff_engine.py` | google-diff-match-patch 封装 | `compute_diff()` 字符级永不超时，NDJSON 流式输出 |
| `idml_parser.py` | IDML 流式解析 + 字体提取 | `extract_text_stream()`，严格错误模式，精确正文过滤 |
| `idml_pdf.py` | PDF 生成管道 | `_build_print_html()`, `generate_report_pdf()` |
| `idml_writer.py` | 编辑后文本写回 IDML ZIP | 解包→替换Story XML→重新打包，保留所有非文本资源 |
| `report_template.py` | `/report` 页面 HTML 模板 | 服务端渲染 |
| `config_loader.py` | `.env` 配置加载 | `SERVER_PORT`, `SERVER_HOST` 等 |
| `backup_manager.py` | 备份管理 | 服务端 JSON 备份序列化/列表/清理 |

### 3.2 前端核心模块

| 目录/文件 | 职责 |
|-----------|------|
| `src/main.ts` | 选择页 Vue 入口 |
| `src/report.ts` | 报告页 Vue 入口 |
| `src/types/index.ts` | `Segment`, `ChangeContext`, `FileInfo` 等类型定义 |
| `src/parser/idml.ts` | 前端 IDML 辅助解析（预览/校验） |
| `src/render/` | 查看/编辑模式 HTML 构建 + 段内样式 + 光标管理 + 分栏/统一视图渲染 |
| `src/export/` | JSON / HTML / PDF / DOCX 导出（PDF 调用服务端） |
| `src/components/select-page/` | 选择页 4 组件 |
| `src/components/report-page/` | 报告页 18+ 组件（含 ViewToggle / UnifiedView / SplitView / BackupButton / ExportDialog / EditReentryDialog 等） |
| `src/utils/postmessage.ts` | 跨窗口通信（origin 校验 + 心跳） |
| `src/utils/storage.ts` | localStorage 封装（sessionId 绑定存储 + 读写 + 清理） |
| `src/utils/backup.ts` | 备份管理（服务端 JSON + 本地 HTML 写入 + 清理） |
| `src/utils/session.ts` | 会话管理（sessionId 生成 + 归档 + 过期清理 + 恢复检测） |
| `src/styles/` | CSS 变量体系 + 主题 |

### 3.3 辅助/封存模块

| 文件 | 状态 | 说明 |
|------|------|------|
| `puppeteer_pdf.cjs` | **封存** | 旧版 Puppeteer 渲染引擎 |
| `playwright_pdf.cjs` | **活跃** | Node.js Playwright + Paged.js 渲染引擎 |
| `pdf_toolkit.py` | **活跃** | pypdf/pdfplumber/fpdf2 统一封装层 |
| `idml_pdf_v20260716.py` | **封存** | 旧版 fpdf2 渲染引擎 |
| `idml_diff.py` | 独立工具 | CLI 版本 IDML diff |

---

## 4. 数据流

### 4.1 对比流程

```
用户选择文件 → POST /api/compare (multipart/form-data)
  │
  ├─ extract_text_stream(orig)  → 原始文本 + 排版元数据
  ├─ extract_text_stream(mod)   → 修改后文本 + 排版元数据
  │
  ├─ diff_match_patch.diff_main(o, m, timeout=0)  → DiffOp[] (永不超时)
  ├─ diff_match_patch.diff_cleanupSemantic() → 语义清理
  │
  ├─ diffResultToSegments()     → Segment[] (合并相邻单字符操作为 mod)
  │
  ├─ buildChangeContext()       → ChangeContext[]
  │
  ├─ 流式返回 (NDJSON chunked)
  │     ├─ chunk 1: {type: "meta", stats, totalChunks}
  │     ├─ chunk 2: {type: "segments", index: 0, data: [...]}
  │     └─ chunk N: {type: "done"}
  │
  └─ 前端：每chunk → IndexedDB写入 → 前3 chunk到达即渲染首屏
```

### 4.2 保存/导出流程

```
用户点击 [📥 导出] → 弹出多格式选择对话框
  │
  ├─ 用户勾选格式：☑ PDF  ☑ IDML  ☐ DOCX  ☐ HTML  ☐ MD  ☐ TXT
  │
  ├─ [导出 PDF] → POST /api/save_pdf {mode, edited_text, patches?}
  │     │  ├─ mode: "diff" → 原始 diff 标注版（查看模式导出）
  │     │  └─ mode: "edit" → 完整双层标注版（编辑模式导出）
  │     │
  │     ├─ diff_match_patch 重新 diff
  │     ├─ _merge_segment_metadata (保留排版信息)
  │     ├─ _build_print_html(segments, userPatches) → 双层标注 HTML
  │     ├─ generate_report_pdf(html_content=...) → Playwright + Paged.js
  │     │     └─ subprocess: node playwright_pdf.cjs <html> <pdf>
  │     │           └─ Playwright launch → Paged.js polyfill → page.pdf(A4)
  │     └─ 返回 {success, download_url, filename}
  │
  ├─ [导出 DOCX] → POST /api/export_docx {edited_text, segments, metadata}
  │     └─ 保留 IDML 排版信息（font-family / font-size / color），输出纯文本
  │
  ├─ [导出 IDML] → POST /api/save_idml {edited_text, original_path}
  │     └─ save_idml() → 返回下载链接
  │
  ├─ [导出 HTML/MD/TXT] → 前端直接构建并下载
  │
  └─ 导出完成 → ExportCompleteDialog（留在编辑 / 返回查看）

[💾 保存更改] → POST /api/autosave {html, text, time}
      └─ IDMLServer.autosaves[key] = {...}
```

### 4.3 报告页编辑保存流程

```
报告页 → 用户点击 [编辑]
  │
  ├─ 首次进入？
  │   ├─ 是 → 自动备份 ──→ 进入编辑
  │   │     ├─ POST /api/backup {segments, contexts, ...}  → 服务端 JSON
  │   │     └─ 写入 project/backups/2026-07-17_xxx.html     → 本地 HTML
  │   │     └─ toast "备份已完成"
  │   │
  │   └─ 否 → 弹出 EditReentryDialog（继续编辑 / 重新开始）
  │         ├─ 继续编辑 → 从 autosave/localStorage 恢复
  │         └─ 重新开始 → 丢弃编辑内容，重载报告
  │
  ├─ contentEditable + oninput (800ms debounce)
  │     └─ localStorage.setItem(autosave_key, {html, text, time})
  │           └─ 5s 静默后 → POST /api/autosave
  │
  ├─ Patch 增量追踪 + 两层叠加渲染
  │     └─ 进入时基线快照 → patch_make(baseline, current) → Patches[]
  │           └─ 原始差异层（只读，始终显示）
  │           └─ 用户编辑层（基于 patches 透明覆盖）
  │
  ├─ [📋 备份] 按钮（随时可用）
  │     └─ 手动创建新备份 → toast "备份已完成"
  │
  ├─ [💾 保存更改] → POST /api/autosave {html, innerText, time}
  │
  ├─ [📥 导出] → ExportDialog（多格式选择）→ 按 §4.2 流程执行
  │     └─ 导出完成后弹出 ExportCompleteDialog
  │
  └─ [📄 写回IDML] → POST /api/save_idml {edited_text, original_path}
```

---

## 5. HTTP API 端点

| 方法 | 路径 | 功能 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/` | 主页面 GUI（选择页） | — | HTML |
| GET | `/report` | 上次对比的报告页 | — | HTML |
| GET | `/api/text?which=mod` | 获取修改版原文 | — | `{text}` |
| GET | `/api/text?which=orig` | 获取原始版原文 | — | `{text}` |
| GET | `/api/poll` | 对比任务状态轮询 | — | `{running, progress}` |
| GET | `/api/autosave?get=1` | 取回自动保存内容 | — | `{success, saved}` |
| GET | `/api/download/<filename>` | 下载生成的文件 | — | 文件流 |
| POST | `/api/compare` | 执行 IDML 对比 | multipart: orig + mod | `{segments, contexts, ...}` |
| POST | `/api/save_pdf` | 生成 diff PDF | `{mode, edited_text, patches?}` | `{success, download_url}` |
| POST | `/api/autosave` | 持久化保存编辑 | `{html, text, time}` | `{success}` |
| POST | `/api/save_idml` | 写回 IDML | `{edited_text, original_path}` | `{success, download_url}` |
| POST | `/api/export_edited` | 导出编辑模式完整标注 PDF | `{edited_text, patches, segments}` | `{success, download_url}` |
| POST | `/api/backup` | 创建对比报告备份 | `{segments, contexts, origText, modText, metadata, html}` | `{success, backup_id, server_path}` |
| GET | `/api/backup/list` | 列出服务端已存备份 | — | `{backups: [{id, timestamp, filename}]}` |
| POST | `/api/backup/clear` | 清除所有备份 | — | `{success, deleted_count}` |

---

## 6. IDML 解析器

### 6.1 解析流程（Python 服务端）

| 步骤 | 细节 |
|------|------|
| **解压** | zipfile 读取 IDML ZIP 包 |
| **字体提取** | 从 IDML ZIP 包内提取内嵌字体文件（OTF/TTF）到 `fonts/` 目录，CSS `@font-face` 引用 |
| **Story 发现** | 正则匹配 designmap.xml 中的 `<idPkg:Story>` 或 `<Story>` 引用 |
| **样式映射** | 解析 Resources/Styles.xml → ParagraphStyle + CharacterStyle Map |
| **属性提取** | font-family / font-size(pt→px) / font-weight / color / tracking / leading |
| **文本遍历** | Story XML → ParagraphStyleRange → CharacterStyleRange → Content |
| **样式合并** | ParagraphStyle 为底 → CharacterStyle 覆盖 → DEFAULT 兜底 |
| **正文过滤** | 跳过所有已知非正文类型（见 §6.3） |
| **字符处理** | XML 实体解码 + 全部字符保留（不设白名单限制，IDML 里有什么就渲染什么） |

### 6.2 错误处理（严格模式）

任何解析错误立即终止，弹窗显示精确错误信息：

| 错误类型 | 提示内容 |
|------|------|
| **ZIP 解压失败** | "无法解压 IDML 文件：[文件名]，文件可能已损坏" |
| **XML 解析错误** | "XML 解析失败：[文件名]，第 [行号] 行：[错误描述]" |
| **Story 文件缺失** | "缺少 Story 文件：[Story名]，IDML 包不完整" |
| **字体提取失败** | "字体 '[字体名]' 提取失败，已跳过"（不阻塞解析，仅提示） |

### 6.3 内容过滤（精确过滤模式）

跳过以下所有非正文类型，仅提取正文 Story：

| 过滤类型 | 识别方式 | 说明 |
|------|------|------|
| footnote / endnote | Story 类型属性 | 脚注、尾注 |
| masterspread | Story 类型属性 | 母版页 |
| toc | Story 类型属性 / 命名规则 | 目录 |
| index | Story 类型属性 / 命名规则 | 索引 |
| conditional-text | XML 元素标签 | 条件文本 |
| xmltag | Story 类型属性 | XML 标签 |
| annotation / comment | Story 类型属性 / 命名规则 | 注释/批注 |
| hyperlink-destination | XML 元素标签 | 超链接锚点 |
| hidden-text | 样式属性 | 隐藏文字 |

### 6.4 Story 结构差异处理

两份 IDML 解析出的 Story 可能数量不同（章节拆分/合并）。处理策略：

**默认全选所有 Story 对比**。在报告页侧边栏提供「Story 筛选」面板：

```
┌── Story 筛选 ──────────┐
│ ☑ 正文故事 1 (Story_u1) │
│ ☑ 正文故事 2 (Story_u2) │
│ ☑ 正文故事 3 (Story_u3) │
│ ☐ 正文故事 4 (Story_u4) │  ← 用户取消勾选
│                         │
│ [重置为全选]             │
└─────────────────────────┘
```

- 取消勾选后对应 Story 文本和差异标记从视图中隐藏，统计信息实时更新
- 筛选仅影响当前视图，关闭报告窗口后恢复全选

### 6.5 字体降级

| 场景 | 策略 |
|------|------|
| **IDML 包内有内嵌字体** | 提取 OTF/TTF 到 `fonts/` 目录，CSS `@font-face` 引用 |
| **内嵌字体缺失** | 使用 CSS font-family 回退链：指定字体 → 同语系通用字体 → serif/sans-serif |
| **字体提取失败** | 跳过并记录，工具栏提示 "N 个字体不可用" |

### 6.6 文件大小限制

| 限制类型 | 值 |
|------|------|
| **最大文件大小** | 2GB |
| **典型文件大小** | 5-100MB |
| **超大文件** | 解析前显示预估处理时间（基于解压后的文本字符数 × 历史 diff 速度），超大文件标注内存风险

---

## 7. Diff 引擎

### 7.1 选型：google-diff-match-patch

- **Python 版**运行在服务端，通过 API 返回 diff 结果
- 字符级对比 + `diff_cleanupSemantic()` 语义清理
- 内置 patch 生成能力：`patch_make(baseline, current)` 产出增量 Patch 列表，用于编辑模式追踪用户变更
- 久经考验的成熟库，无需维护自研算法

### 7.2 精度要求

**绝对不允许降级。** 必须始终输出字符级精确 diff。

| 策略 | 说明 |
|------|------|
| **禁用超时** | 不设 diff 超时限制，字符级精确比对到底 |
| **等待策略** | 不设等待上限，服务端跑多久等多久 |
| **进度提示** | 选择页实时显示 "对比中...（已解析 X 万字，预估还需 Y 秒）" |
| **超大文档** | 10 万字符以上在选择页标注 "大型文档，对比可能需要较长时间" |

### 7.3 核心流程

```
【初始对比 — 服务端】
原始文本 + 修改文本
       ↓
diff_match_patch.diff_main(orig, mod, timeout=0)  →  永不超时
       ↓
diff_match_patch.diff_cleanupSemantic()
       ↓
diffResultToSegments()  →  Segment[] (合并相邻单字符操作为 mod)
       ↓
buildChangeContext()    →  ChangeContext[]
       ↓
返回 JSON: {segments, contexts, origText, modText, metadata, stats}
```

### 7.4 边界情况

| 场景 | 行为 |
|------|------|
| **两份文档完全一致** | 显示完整文本（无任何标记），报告页顶部 toast "两份文档完全相同，未发现差异"，侧边栏统计：变更数 0 |
| **一份文档为空** | 显示：原文档全部标记为删除 / 修改版全部标记为新增，侧边栏提示 "对方文档为空" |
| **两份文档均为空** | 选择页直接弹窗 "两份文档均为空文件，无法对比"，不打开报告页 |
| **仅格式差异无文本差异** | 显示完整文本 + 格式变更标记（紫色），侧边栏仅显示格式变更 |

### 7.5 海量变更自适应导航

根据变更数量自动切换侧边栏展示策略：

#### < 50 处：完整卡片模式

所有变更逐条显示为卡片，点击跳转（和现有设计一致）。

#### 50 ~ 500 处：分组折叠模式

```
侧边栏：

┌──────────────────────────┐
│ 📊 变更统计               │
│ 新增 152  |  删除 89      │
│ 修改 341  |  格式 12      │
│ 合计 594 处               │
├──────────────────────────┤
│ ▼ 修改（341）   展开全部   │
│  · 第1处 · 梳理→整理      │
│  · 第2处 · 蘋果→苹果      │
│  · ...共显示5条代表       │
│                          │
│ ▼ 新增（152）   展开全部   │
│  · 第1处 · +社会          │
│  · ...共显示5条代表       │
│                          │
│ ▶ 删除（89）    折叠      │
│ ▶ 格式（12）    折叠      │
├──────────────────────────┤
│ 🔍 在变更中搜索...         │
└──────────────────────────┘
```

每组默认显示前 5 条，点击「展开全部」加载完整列表。组内可按位置排序。

#### > 500 处：热力图 + 统计模式

侧边栏顶部显示**变更密度热力图**——一条纵向色带代表整个文档，颜色深浅对应变更密集度。点击热力图任意位置跳转到对应文档区域。

热力图下方保留分类统计和搜索栏。键盘 J/K 跳转时优先在热力密集区内导航。

**切换完全自动**，基于变更总数判定，无需用户手动配置。

### 7.6 DiffOp 类型

```typescript
interface DiffOp  { type: '=' | '+' | '-'; text: string; }

// Patch：增量编辑操作
interface Patch {
  diffs: DiffOp[];        // 该 patch 内的 diff 操作序列
  start1: number;         // 基线文本起始位置
  start2: number;         // 当前文本起始位置
  length1: number;        // 基线文本变更长度
  length2: number;        // 当前文本变更长度
}

// 用户编辑记录
interface UserEdit {
  patches: Patch[];       // 增量 patch 列表
  timestamp: number;
}
```

---

## 8. 数据模型

### 8.1 Segment

```typescript
interface Segment {
  text: string;
  operation: 'add' | 'del' | 'mod' | 'format' | 'none';
  origin: 'original' | 'user';
  side?: 'old' | 'new';
  font: string;           // 字体族名
  fontSize: number;       // px
  fontWeight: number;     // 400/700/800
  color: string;          // hex 或 'inherit'
  tracking: number;       // IDML 字距 (1/1000 em)
  leading: number;        // IDML 行距 (px)
  ci?: number;            // change index，用于跳转
}
```

### 8.2 两层叠加渲染

编辑模式采用**两层叠加**渲染，替代原来的 classifyOps 分类合并：

- **原始差异层**（只读，z-index: 1）：始终显示文档 A vs B 的原始差异（4 色：del/add/mod-old/mod-new/format）
- **用户编辑层**（z-index: 2，不透明覆盖）：基于 `patch_make(baseline, current)` 产出的 Patches 渲染用户编辑（4 色：user-del/user-add/user-mod-old/user-mod-new）
- **覆盖规则**：用户编辑层采取**不透明覆盖**策略——凡用户操作过的字符，用户编辑层在该位置不透明，完全遮挡原始差异层，仅显示用户编辑颜色。原始标记只在用户未触碰的区域可见
- 用户可通过工具栏开关独立控制每层可见性
- 两层从不合并，避免了编辑与原始差异重叠时的分类歧义

### 8.3 渲染映射（8 色体系 + 覆盖优先级）

#### 8.3.1 CSS 类名映射

| operation | origin | side | CSS 类名 | 所属层 |
|-----------|--------|------|----------|--------|
| add | original | — | `seg add` | 原始差异层 |
| del | original | — | `seg del` | 原始差异层 |
| mod | original | old | `seg mod-old` | 原始差异层 |
| mod | original | new | `seg mod-new` | 原始差异层 |
| add | user | — | `seg user-add` | 用户编辑层 |
| del | user | — | `seg user-del` | 用户编辑层 |
| mod | user | old | `seg user-mod-old` | 用户编辑层 |
| mod | user | new | `seg user-mod-new` | 用户编辑层 |
| format | original | — | `seg fmt` | 原始差异层 |
| none | — | — | `seg` | — |

#### 8.3.2 颜色覆盖优先级规则

**核心原则：用户编辑永远覆盖原始 diff 标记。** 凡被用户操作过的字符，显示用户编辑颜色，原始 diff 颜色被完全替代。

| 原始标记 | 用户操作 | 界面显示 | 撤销后 |
|----------|----------|----------|--------|
| add（绿增） | 删除 | `user-del`（紫底+删除线+虚线边框） | 恢复绿色新增 |
| add（绿增） | 修改 | `user-mod`（暖橙修改色） | 恢复绿色新增 |
| del（红删） | 恢复/新增 | `user-add`（琥珀/暖橙底+加粗+虚线边框） | 恢复红色删除 |
| del（红删） | 修改 | `user-mod`（暖橙修改色） | 恢复红色删除 |
| mod（红绿修改） | 再次修改 | `user-mod`（暖橙修改色，完全覆盖原标记） | 恢复原始红绿修改标记 |
| format（紫格式） | 删除 | `user-del`（紫底+删除线） | 恢复格式变更标记 |
| none（无标记） | 新增 | `user-add`（琥珀/暖橙底+加粗+虚线边框） | 恢复纯文本，无标记 |
| none（无标记） | 删除 | `user-del`（紫底+删除线+虚线边框） | 恢复纯文本，无标记 |
| none（无标记） | 修改 | `user-mod`（暖橙修改色） | 恢复纯文本，无标记 |

### 8.4 ChangeContext

```typescript
interface ChangeContext {
  index: number;         // 第 N 处
  total: number;         // 共 M 处
  type: 'add' | 'del' | 'mod' | 'format';
  before: string;        // 前文上下文
  highlight: string;     // 变更文字
  after: string;         // 后文上下文
}
```

### 8.5 跨窗口消息协议

详见 §13 完整规范，此处仅列出类型签名：

```typescript
type MainToReport =
  | { type: 'diff-data'; sessionId: string; segments: Segment[]; contexts: ChangeContext[]; originalText: string; modifiedText: string; fileA: FileInfo; fileB: FileInfo }
  | { type: 'shutdown-request' };

type ReportToMain =
  | { type: 'ready' }
  | { type: 'closing'; hasUnsavedEdits: boolean }
  | { type: 'heartbeat' }
  | { type: 'edit-state'; isEditing: boolean; lastEditTime: number };
```

---

## 9. 颜色方案

仅亮色模式。提供 4 套预设配色主题，通过 `data-theme` 属性切换 CSS 变量。工具栏「主题」下拉菜单切换，默认使用「默认」主题。

### 9.1 默认 (Default)

```css
[data-theme="default"] {
  --del-bg: #ffe0e0; --del-text: #cc0000; --del-line: #e60000;
  --add-bg: #d4f5d4; --add-text: #006600; --add-line: #00aa00;
  --mod-old-bg: #ffe0e0; --mod-old-text: #cc0000;
  --mod-new-bg: #d4f5d4; --mod-new-text: #006600;
  --fmt-bg: #f3e8ff; --fmt-text: #4c1d95; --fmt-line: #a78bfa;
  --user-add-bg: #fff0d6; --user-add-text: #b45309; --user-add-line: #d97706;
  --user-del-bg: #f0e6ff; --user-del-text: #6b21a8; --user-del-line: #7c3aed;
  --user-mod-old-bg: #fef3c7; --user-mod-old-text: #92400e;
  --user-mod-new-bg: #fef3c7; --user-mod-new-text: #92400e; --user-mod-new-line: #92400e;

  --search-highlight: #fff9c4; --focus-outline: #e60000;
  --card-selected-border: #e60000; --edit-accent: #d97706;
  --save-success: rgba(0,130,0,0.85); --save-error: rgba(200,0,0,0.85);

  --sidebar-width: 340px; --topbar-height: 44px;
  --sidebar-bg: #f8f6f1; --sidebar-border: #e5dfd3;
  --doc-bg: #fdfbf7; --text-primary: #2c2416; --text-dim: #8c8068;
  --btn-bg: #fff; --btn-border: #d4c9b5; --btn-hover: #f5f0e8;
  --radius: 6px;
}
```

### 9.2 暖色 (Warm)

```css
[data-theme="warm"] {
  --del-bg: #fce4d6; --del-text: #c2410c; --del-line: #d97706;
  --add-bg: #d1e7d0; --add-text: #2d6a4f; --add-line: #40916c;
  --mod-old-bg: #fce4d6; --mod-old-text: #c2410c;
  --mod-new-bg: #d1e7d0; --mod-new-text: #2d6a4f;
  --fmt-bg: #ede0d4; --fmt-text: #7f5539; --fmt-line: #b08968;
  --user-add-bg: #fef0c7; --user-add-text: #a16207; --user-add-line: #ca8a04;
  --user-del-bg: #f2e8dc; --user-del-text: #8b5e3c; --user-del-line: #a47148;
  --user-mod-old-bg: #fdf2d0; --user-mod-old-text: #b7791f;
  --user-mod-new-bg: #fdf2d0; --user-mod-new-text: #b7791f; --user-mod-new-line: #b7791f;

  --search-highlight: #fef9c3; --focus-outline: #c2410c;
  --card-selected-border: #c2410c; --edit-accent: #ca8a04;
  --save-success: rgba(45,106,79,0.85); --save-error: rgba(194,65,12,0.85);

  --sidebar-bg: #faf6f0; --sidebar-border: #e8dcc8;
  --doc-bg: #fefcf7; --text-primary: #3d2e1c; --text-dim: #8c7a60;
  --btn-bg: #fff; --btn-border: #d4c0a0; --btn-hover: #f8f0e4;
  --radius: 6px;
}
```

### 9.3 高对比度 (High Contrast)

```css
[data-theme="high-contrast"] {
  --del-bg: #ffcccc; --del-text: #b30000; --del-line: #cc0000;
  --add-bg: #b3e6b3; --add-text: #004d00; --add-line: #008000;
  --mod-old-bg: #ffcccc; --mod-old-text: #b30000;
  --mod-new-bg: #b3e6b3; --mod-new-text: #004d00;
  --fmt-bg: #e6ccff; --fmt-text: #3d0099; --fmt-line: #7b2dff;
  --user-add-bg: #ffe6b3; --user-add-text: #8c3a00; --user-add-line: #cc5500;
  --user-del-bg: #ddccff; --user-del-text: #5200cc; --user-del-line: #7300e6;
  --user-mod-old-bg: #ffeb99; --user-mod-old-text: #7a2e00;
  --user-mod-new-bg: #ffeb99; --user-mod-new-text: #7a2e00; --user-mod-new-line: #7a2e00;

  --search-highlight: #ffff66; --focus-outline: #cc0000;
  --card-selected-border: #cc0000; --edit-accent: #cc5500;
  --save-success: rgba(0,77,0,0.85); --save-error: rgba(179,0,0,0.85);

  --sidebar-bg: #fdfdff; --sidebar-border: #d0d0d0;
  --doc-bg: #ffffff; --text-primary: #000000; --text-dim: #555555;
  --btn-bg: #fff; --btn-border: #999; --btn-hover: #eee;
  --radius: 6px;
}
```

### 9.4 柔光 (Soft)

```css
[data-theme="soft"] {
  --del-bg: #fbeaec; --del-text: #c77d7d; --del-line: #d4a0a0;
  --add-bg: #e3f0e0; --add-text: #6b9e6b; --add-line: #8fb88f;
  --mod-old-bg: #fbeaec; --mod-old-text: #c77d7d;
  --mod-new-bg: #e3f0e0; --mod-new-text: #6b9e6b;
  --fmt-bg: #f0edf7; --fmt-text: #8b7aaa; --fmt-line: #b8a8d4;
  --user-add-bg: #faf3e0; --user-add-text: #b8a060; --user-add-line: #ccb878;
  --user-del-bg: #f0edf7; --user-del-text: #9b8ac4; --user-del-line: #b8a8d8;
  --user-mod-old-bg: #faf5e8; --user-mod-old-text: #b8a068;
  --user-mod-new-bg: #faf5e8; --user-mod-new-text: #b8a068; --user-mod-new-line: #b8a068;

  --search-highlight: #faf5c8; --focus-outline: #c77d7d;
  --card-selected-border: #c77d7d; --edit-accent: #ccb878;
  --save-success: rgba(107,158,107,0.85); --save-error: rgba(199,125,125,0.85);

  --sidebar-bg: #faf8f5; --sidebar-border: #e8e2d8;
  --doc-bg: #fefdfb; --text-primary: #3d3830; --text-dim: #9c9488;
  --btn-bg: #fff; --btn-border: #d8d0c4; --btn-hover: #f5f0e8;
  --radius: 6px;
}
```

### 9.5 标记规则（所有主题通用）

| 变更类型 | 背景 | 文字 | 边框 | 附加 |
|----------|------|------|------|------|
| **原始删除** | `--del-bg` | `--del-text` | 2px 实线 `--del-line` | 删除线 |
| **原始新增** | `--add-bg` | `--add-text` | 2px 实线 `--add-line` | font-weight: 800 |
| **修改-旧** | `--mod-old-bg` | `--mod-old-text` | — | 删除线 |
| **修改-新** | `--mod-new-bg` | `--mod-new-text` | — | font-weight: 700 |
| **格式变更** | `--fmt-bg` | `--fmt-text` | — | 虚线下划线 (`--fmt-line`) |
| **用户新增** | `--user-add-bg` | `--user-add-text` | 2px 虚线 `--user-add-line` | font-weight: 600 |
| **用户删除** | `--user-del-bg` | `--user-del-text` | 2px 虚线 `--user-del-line` | 删除线 |
| **用户修改-旧** | `--user-mod-old-bg` | `--user-mod-old-text` | 1px 虚线 | 删除线 |
| **用户修改-新** | `--user-mod-new-bg` | `--user-mod-new-text` | 1px 虚线 `--user-mod-new-line` | font-weight: 700 |
| **搜索高亮** | `--search-highlight` | inherit | — | — |
| **当前聚焦** | `#fff3cd` | — | 4px `--focus-outline` + 脉冲动画 | — |

### 9.6 主题切换

- 工具栏设置菜单 →「配色主题」下拉选择
- 选择后即时生效（`document.documentElement.setAttribute('data-theme', ...)`）
- 选择通过 localStorage 持久化：`idml_theme_preference`

---

## 10. PDF 渲染管道

### 10.1 当前 PDF 输出规格

- **引擎**：Playwright（Chromium 无头浏览器）+ Paged.js（CSS Paged Media polyfill）
- **分页控制**：Paged.js 提供 `@page` 规则、页眉页脚、页码、分页符精确控制
- **页面格式**：A4 竖版 (210×297mm)，边距 20mm/18mm
- **文本流向**：横排 `horizontal-tb`，文字从左到右水平排列
- **段落结构**：`<p class="doc-block">` + `page-break-inside: avoid`
- **Diff 标注**：`<span class="seg del">` 红色删除线 + `<span class="seg add">` 绿色加粗
- **变更分隔符**：`<p class="doc-sep">— — —</p>` 在变更类型切换时插入
- **排版元数据**：font-family / font-size / font-weight / letter-spacing / line-height 保留
- **渲染质量**：2x deviceScaleFactor，`printBackground: true`
- **Playwright 视口**：2000×1000（宽幅确保内容不被裁切）

### 10.2 已知限制

| 限制 | 说明 | 状态 |
|------|------|------|
| 字体嵌入 | 依赖系统已安装字体，无子集化 | 可接受 |
| 大文件 PDF | Playwright 单进程渲染，超 30 段可能较慢 | 待监控 |

---

## 11. 界面功能

### 11.1 选择页

| 功能 | 实现 |
|------|------|
| **文件上传** | 拖拽 + 点击，FileUploader.vue ×2 |
| **格式校验** | 非 .idml 拒绝 + 弹窗提示；>50MB 拒绝 |
| **执行流程** | 解析 A → 解析 B → 服务端 diff → 多窗口检测（§13.2）→ 开窗 → postMessage 发送（默认打开统一视图，用户可按需切换到分栏视图） |
| **进度提示** | "解析文档 A..." → "解析文档 B..." → "执行对比..." → "打开报告..." |
| **错误处理** | 弹窗显示具体错误信息 |

### 11.2 报告页 — 查看模式

查看模式下提供两种视图，通过工具栏按钮一键切换：

#### 11.2.1 工具栏

| 控件 | 功能 |
|------|------|
| **标题** | 文档对比报告标题 |
| **视图切换** | `[分栏视图]` `[统一视图]` 按钮组，高亮当前选中视图 |
| **单侧视图** | `[原始文件]` `[修改文件]` 按钮组，仅显示单侧文档原始内容 |
| **图例** | 8 色标记说明（查看模式下显示原始差异 4 色，编辑模式下显示 8 色） |
| **配色主题** | 工具栏设置 →「配色主题」下拉：默认 / 暖色 / 高对比度 / 柔光 |
| **搜索** | 内嵌 SearchBar.vue，Ctrl+F 激活；展开后显示高级选项（大小写/全词/类型过滤/替换） |
| **模式切换** | `[查看]` `[编辑]` 按钮组 |
| **差异导航** | ← N/M → 按钮 + 跳转浮标 |
| **导出** | 导出▼ 下拉菜单（PDF / JSON / HTML） |
| **侧边栏开关** | 关闭/打开侧边栏按钮 |
| **设置** | ⚙️ 齿轮按钮 → 右侧抽屉设置面板（§11.5） |

#### 11.2.2 统一视图（Unified View）

差异以单一文本流内联展示，原文与修改后的文本合并为一段，变更内容通过颜色/标记区分。

| 特性 | 说明 |
|------|------|
| **布局** | 单列宽度自适应（max-width 约 800px），居中显示 |
| **文本流** | 所有删除、新增、修改操作内嵌同一文本流，连续上下文不中断 |
| **行号** | 左侧双行号标注（原文行号 / 修改版行号），同时显示两个版本的位置参照 |
| **删除标记** | 红色背景 (#ffe0e0) + 红色文字 (#cc0000) + 删除线 + 2px 实线边框 |
| **新增标记** | 绿色背景 (#d4f5d4) + 绿色文字 (#006600) + 加粗 + 2px 实线边框 |
| **修改标记** | 旧值：红底 + 删除线；新值：绿底 + 加粗 |
| **格式变更** | 紫色背景 (#f3e8ff) + 紫色文字 (#4c1d95) + 虚线下划线 |
| **变更行高亮** | 当前聚焦的变更行左侧 3px 蓝色竖线 + 淡蓝背景 |
| **跳转** | 点击侧边栏变更卡片 → 滚动到对应行并高亮聚焦 |
| **虚拟滚动** | 大文档使用 virtuoso 虚拟列表，仅渲染可视区域 |

#### 11.2.3 分栏视图（Split View）

原文与修改后的文本左右分栏并排显示，按行对齐同步滚动，清晰比对每行差异。

| 特性 | 说明 |
|------|------|
| **布局** | Grid 双栏：`minmax(280px, 1fr) 24px(分隔线) minmax(280px, 1fr)`，每栏最小 280px |
| **左栏** | 显示原始文本，被删除字符用红色标记（删除线 + 红底），修改旧值同步标注 |
| **右栏** | 显示修改后文本，新增字符用绿色标记（加粗 + 绿底），修改新值同步标注 |
| **中间分隔** | 24px 分隔线区域（含竖线视觉分隔） |
| **行对齐** | 左右两栏按语义行对齐；删除行左侧显示原始内容、右侧为空；新增行左侧为空、右侧显示新内容 |
| **同步滚动** | 左右两栏垂直滚动完全同步 |
| **变更行高亮** | 当前聚焦变更行整行淡蓝背景 + 左侧 3px 蓝色竖线指示 |
| **跳转** | 点击侧边栏变更卡片 → 双栏同步滚动到对应行 + 聚焦高亮 |
| **虚拟滚动** | 大文档使用 virtuoso 虚拟列表，双栏同步渲染 |

#### 11.2.4 单侧视图

通过 `[原始文件]` / `[修改文件]` 按钮切换，仅显示单侧文档的纯文本内容（不含 diff 标记），用于快速查看原文内容。

| 特性 | 说明 |
|------|------|
| **原始文件** | 仅显示原始文本全文（无 diff 标记），适用于查看原文档内容 |
| **修改文件** | 仅显示修改后文本全文（无 diff 标记），适用于查看修改后文档内容 |
| **切换** | 按钮组即时切换，不重新计算 diff |
| **布局** | 复用当前视图布局（分栏/统一）的单侧版本 |

#### 11.2.5 通用交互

| 功能 | 实现 |
|------|------|
| **侧边栏** | 标题 + 文件名 / 2×3 统计卡片 / 变更明细卡片列表（点击跳转）/ 可折叠 |
| **跳转浮标** | 导航时屏幕中央浮现 "第 N/M 处·类型" |
| **搜索高亮** | 匹配文字黄色背景（`--search-highlight`）+ 当前聚焦橙色背景 + 4px 红色边框脉冲 |
| **键盘** | J/K 导航差异（非搜索状态）；Enter/Shift+Enter 跳转搜索结果（搜索激活时）；Ctrl+F 搜索；E 切换编辑模式；Escape 关闭搜索/弹窗 |

#### 11.2.6 加载与进度体验

##### 文件上传

选择页上传区域内嵌进度条：

```
┌──────────────────────────────────┐
│  原始文件                         │
│  ██████████░░░░░░ 128MB/1.82GB   │
│  7% · 上传中                      │
└──────────────────────────────────┘
```

> **规则**：圆角进度条 + 百分比 + 已传/总大小。上传完成后显示 "✓ 已就绪"。>500MB 显示预估时间。

##### 对比进度（渐进式渲染）

点击 [对比] 后**立即打开报告页**（不等待 diff 完成），利用 NDJSON 流式数据渐进式渲染：

```
报告页打开 0.5s

┌────────────────────────────────────────────┐
│ 工具栏                                      │
├────────────────────────────────────────────┤
│ ⏳ 对比进行中... 已接收 12/42 块             │  ← 黄色进度头
│    文本 3.2万字 · 已发现 47处差异            │  ← 实时更新
│    ████████░░░░░░ 28%  预计还需 8秒          │  ← 进度条
├──────────────┬─────────────────────────────┤
│ 侧边栏        │ 文档区                       │
│ 变更：47 ↑    │  已到达内容正常渲染            │
│ 新增：23      │  未到达区域灰底骨架屏 ░░░░░░░░│
│ 删除：15      │                              │
│ 修改：9       │                              │
│ （实时跳动）   │                              │
└──────────────┴─────────────────────────────┘

42/42 块全部到达 → 进度头消失 → 报告页完全可用
```

| 规则 | 说明 |
|------|------|
| **即时打开** | 不等待 diff，选择页点对比后立即 `window.open` 报告页 |
| **进度头** | 黄色背景条，显示 chunk 进度、已解析字数、已发现差异数、进度条、预估剩余时间 |
| **实时统计** | 侧边栏统计数字随 chunk 到达实时跳动增长 |
| **骨架屏** | 未到达的文本区域显示灰色占位，已到达区域正常渲染 |
| **取消** | 进度头右侧 [✕ 取消] 按钮，关闭报告页并终止请求 |
| **完成** | 全部 chunk 到达后进度头消失（0.3s 淡出动画），报告页进入完全交互状态 |

##### PDF 生成等待

```
┌──────────────────────────────────┐
│  📄 正在生成 PDF...               │
│  ██████████░░░░ 67%              │
│  渲染第 14/21 页                  │
│                                  │
│  PDF 生成可能需要 10-30 秒         │
│           [取消]                 │
└──────────────────────────────────┘
```

模态弹窗，不可关闭（只能取消），显示渲染进度。

##### IDML 写回等待

```
┌──────────────────────────────────┐
│  📦 正在写回 IDML...              │
│  解包 → 替换文本 → 重新打包       │
│          ░░░░░░░░░░░░░░░░        │
│                                  │
│           [取消]                 │
└──────────────────────────────────┘
```

步骤式进度指示（解包 → 替换 → 打包），每步完成点亮 √。

### 11.3 报告页 — 编辑模式

编辑模式下同样支持分栏视图和统一视图切换，用户可在两种视图下编辑。

**进入编辑时，自动切换到统一视图**（统一文本流更适合编辑操作），编辑完成后可手动切回分栏视图对比结果。

#### 11.3.1 进入编辑流程（含备份）

```
用户点击 [编辑]
  │
  ├─ 检查文档字符数 > 5000 → 弹窗确认（同现有逻辑）
  │
  ├─ 检查是否首次进入编辑
  │   ├─ 是 → 自动备份（服务端JSON + 本地HTML）
  │   │       备份成功 → 进入编辑
  │   │       备份失败 → 弹窗提示错误，阻止进入编辑
  │   └─ 否 → 已有编辑内容
  │            ┌──────────────────────────────────┐
  │            │  检测到之前的编辑内容               │
  │            │                                  │
  │            │  ● 继续编辑（推荐）                 │
  │            │    恢复上次编辑状态，接着修改         │
  │            │                                  │
  │            │  ○ 重新开始                        │
  │            │    丢弃当前编辑，从原始报告重新开始    │
  │            │    （初始备份保持不变）              │
  │            │                                  │
  │            │           [取消]                  │
  │            └──────────────────────────────────┘
  │            ├─ 继续编辑 → 从 autosave/localStorage 恢复编辑状态
  │            └─ 重新开始 → 丢弃编辑，重新加载对比报告进入编辑，不创建新备份
  │
  └─ 进入编辑视图（统一视图）
```

#### 11.3.2 备份机制

| 维度 | 方案 |
|------|------|
| **触发** | 首次进入编辑时自动备份；工具栏「备份」按钮随时手动触发 |
| **自动备份内容** | 完整对比报告：segments、contexts、两份原文、统计、视图状态 |
| **服务端备份** | JSON 快照，通过 `/api/backup` 保存，与 autosave 独立 |
| **本地备份** | 完整 HTML 文件，保存至项目目录 `backups/`（路径在设置中可配） |
| **文件命名** | `时间戳_原文件名_对比报告.html`，如 `2026-07-17_09-30-15_391对比报告.html` |
| **备份管理** | 无备份管理面板，纯文件系统可见；设置页提供「清除所有备份」按钮手动清理 |
| **容错** | 备份失败则阻止进入编辑模式，弹窗提示具体原因（磁盘满/服务端不可达） |

#### 11.3.3 编辑功能

| 功能 | 实现 |
|------|------|
| **激活** | 工具栏 [编辑] 按钮；文档 >5000 字弹窗确认 |
| **视图** | 进入编辑时自动切到统一视图；编辑完成后可手动切回分栏查看对比结果 |
| **界面变化** | 侧边栏隐藏 / 导航隐藏 / 工具栏新增 [💾 保存] [📥 导出] [📄 写回IDML] [📋 备份] 按钮 / 字数 + diff 状态显示 |
| **编辑** | contentEditable / 橙色内阴影边框 / 800ms 防抖 |
| **diff 标记** | 原始对比标记保留（红绿删除新增等），用户编辑用不同颜色覆盖（8 色双层体系）；**用户编辑颜色永远覆盖原始 diff 标记**，被编辑过的字符不再显示原始颜色 |
| **三方 Diff** | 进入时基线快照 → patch_make 增量追踪 → 两层叠加渲染（原始差异层 + 用户编辑层，用户层不透明覆盖原始层） |
| **光标保持** | saveCursor/restoreCursor (TreeWalker) |
| **粘贴** | 强制 text/plain |
| **保存** | 预览确认弹窗（原始→编辑后）→ 确认 |
| **导出** | 编辑模式下可直接导出：标注版 PDF（含原始差异 + 用户编辑完整标注）或写回 IDML |
| **撤销** | Ctrl+Z / Ctrl+Y |

### 11.4 导出

#### 11.4.1 导出场景与格式

| 场景 | 格式 | 内容 | 入口 |
|------|------|------|------|
| **查看模式** | PDF | 带原始 diff 标注的对比报告 | 工具栏导出▼ → 导出PDF |
| **编辑模式** | PDF | 完整标注版（原始差异 + 用户编辑，8 色双层标记） | 编辑工具栏 [📥 导出] |
| **编辑模式** | IDML | 编辑后文本写回 IDML ZIP 包 | 编辑工具栏 [📥 导出] → IDML |
| **编辑模式** | DOCX | 编辑后最终文本，保留 IDML 原始字体/字号/颜色排版信息 | 编辑工具栏 [📥 导出] → DOCX |
| **编辑模式** | HTML | 编辑后纯文本（无 diff 标记） | 编辑工具栏 [📥 导出] → HTML |
| **编辑模式** | MD | 编辑后纯 Markdown 文本 | 编辑工具栏 [📥 导出] → Markdown |
| **编辑模式** | TXT | 编辑后纯文本，无任何格式 | 编辑工具栏 [📥 导出] → 纯文本 |
| **保存弹窗** | PDF / IDML | 同上 | SaveDialog 按钮 |

#### 11.4.2 格式标注策略

| 格式 | 标注层级 | 说明 |
|------|----------|------|
| **PDF** | 双层完整标注 | 原始 diff 标记（红绿） + 用户编辑标记（暖橙/紫色），等同于浏览器编辑视图所见 |
| **DOCX** | 无标注，保留排版 | **彻底移除**被删文字，仅输出编辑后最终文本，保留 IDML 原始字体族/字号(pt)/颜色/字距/行距 |
| **HTML** | 无标注 | 彻底移除被删文字，编辑后纯文本，含基础段落结构 |
| **Markdown** | 无标注 | 彻底移除被删文字，编辑后纯 Markdown 文本 |
| **TXT** | 无标注 | 彻底移除被删文字，编辑后纯文本，无任何格式 |

#### 11.4.3 导出后行为

导出成功后弹出确认框：

```
┌────────────────────────────────────┐
│  导出完成                           │
│                                    │
│  文件已保存至：backups/xxx.pdf       │
│                                    │
│  ● 留在编辑模式继续修改               │
│  ○ 返回查看模式                      │
│                                    │
│           [确定]                    │
└────────────────────────────────────┘
```

- 选择「留在编辑模式」→ 关闭弹窗，继续编辑
- 选择「返回查看模式」→ 退出编辑，回到查看模式报告页

### 11.5 设置

工具栏最右侧 ⚙️ 齿轮图标，点击弹出设置面板（右侧抽屉）。

#### 11.5.1 设置项

| 分类 | 设置项 | 控件 | 默认值 | 说明 |
|------|--------|------|--------|------|
| **常规** | 配色主题 | 下拉选择 | 默认 | 默认 / 暖色 / 高对比度 / 柔光 |
| **常规** | 备份路径 | 输入框 + 浏览按钮 | `project/backups/` | 本地 HTML 备份保存路径 |
| **常规** | 清除缓存 | 按钮 + 二次确认 | — | 一键清除所有 `idml_` 前缀的 localStorage + IndexedDB |
| **高级** | 滚动缓冲区 | 数字输入 | 50 | 虚拟滚动视窗前后的缓冲条数 |
| **高级** | 内存警告阈值 | 两个数字输入 | 黄条 100MB / 红条 500MB | 对比前预估内存超过此值时触发警告提示 |
| **高级** | 会话保留时长 | 数字输入 | 24 | 归档会话的保留时长（小时），超时自动清理 |
| **高级** | 编辑确认阈值 | 数字输入 | 5000 | 进入编辑模式时弹出确认的字数阈值 |
| **高级** | CSS 变量覆盖 | 展开式 hex 色盘列表 | — | 手动覆盖当前主题的任意 CSS 变量，重置按钮恢复 |

#### 11.5.2 行为规则

| 规则 | 说明 |
|------|------|
| **即时生效** | 所有设置项修改后立即生效，无需保存/刷新 |
| **localStorage 持久化** | 设置保存至 `idml_settings`，跨会话保持 |
| **范围** | 设置仅影响当前浏览器，不跨设备同步 |
| **重置** | 高级选项中每个分类提供「恢复默认」按钮 |
| **清除缓存确认** | 点击后弹确认框："将清除所有本地对比数据和缓存。备份文件不受影响。确定？" |

### 11.6 IDML 反向写入

编辑完成后将文本写回 IDML ZIP 包，生成可被 InDesign 直接打开的新文件。

#### 11.6.1 写入策略

| 维度 | 策略 |
|------|------|
| **输出** | 生成**新** IDML ZIP 包，不覆盖原始文件 |
| **文本** | 编辑后的最终**干净文本**，不含任何 diff 标记、修订痕迹或批注 |
| **其他一切** | **完整保留**——图片、链接、母版页、段落样式、字符样式、字体引用、间距、颜色、表格、所有非正文 XML |
| **本质** | 对原始 IDML 的唯一改动是替换 Story XML 文件中的正文文本内容 |

#### 11.6.2 技术流程

```
原始 IDML (ZIP)
  │
  ├─ 解包到临时目录
  │     ├─ META-INF/
  │     ├─ Resources/
  │     │     ├─ Styles.xml        ← 保留
  │     │     ├─ Fonts/            ← 保留
  │     │     └─ Graphics/         ← 保留
  │     ├─ Stories/
  │     │     ├─ Story_u1.xml      ← 替换正文文本
  │     │     ├─ Story_u2.xml      ← 替换正文文本
  │     │     └─ ...
  │     ├─ MasterSpreads/          ← 保留
  │     ├─ designmap.xml           ← 保留
  │     └─ mimetype                ← 保留
  │
  ├─ 编辑后的文本 → 写入 Story XML
  │     ├─ 保持原有 XML 结构：ParagraphStyleRange → CharacterStyleRange
  │     ├─ Content 节点文本替换 → 用户编辑后的最终文本
  │     └─ 重新计算字符偏移和段落范围
  │
  ├─ 重新打包为 ZIP → 新 IDML 文件
  │
  └─ 返回下载链接
```

#### 11.6.3 约束条件

| 约束 | 说明 |
|------|------|
| **结构必须匹配** | 编辑后的文本按原 Story 分段写回，不改变 Story 数量和顺序 |
| **字数变化容忍** | 编辑后的文本长度可以与原文不同（增删字符），XML 结构和样式引用自动调整 |
| **字符编码** | 统一 UTF-8，XML 实体自动编码 |
| **Stories 过滤一致性** | 写入时仅写回被解析提取过正文的 Story，被过滤的非正文 Story（脚注/母版等）保持原样 |
| **导出入口** | 编辑模式工具栏 [📥 导出] → 勾选 IDML；或保存弹窗中 [📄 写回IDML] |



---

## 12. 页面组件树

```
选择页 (index.html)
└── App.vue
    ├── FileUploader.vue ×2
    └── ValidationDialog.vue

报告页 (report.html)
└── AppLayout.vue
    ├── Sidebar.vue
    │   ├── StatsGrid.vue
    │   ├── ChangeCardList.vue → ChangeCard.vue ×N
    │   ├── ChangeHeatmap.vue          # 变更密度热力图（>500 处变更时显示）
    │   ├── StoryFilter.vue            # Story 筛选面板
    │   └── SearchMatchList.vue        # 搜索时切换为匹配结果列表
    ├── DocToolbar.vue
    │   ├── SearchBar.vue
    │   │   └── SearchAdvanced.vue    # 高级选项面板（大小写/全词/类型过滤/替换）
    │   ├── ViewToggle.vue          # [分栏视图] [统一视图] 按钮组
    │   ├── SideToggle.vue          # [原始文件] [修改文件] 按钮组
    │   ├── BackupButton.vue        # [📋 备份] 按钮 + toast 提示
    │   └── ProgressHeader.vue      # ⏳ 流式对比进度头（chunk进度+统计+进度条）
    ├── DocArea.vue (查看模式容器)
    │   ├── UnifiedView.vue         # 统一视图 — 单一差异文本流
    │   └── SplitView.vue           # 分栏视图 — 左右双栏对照
    ├── DocEditArea.vue (编辑模式容器)
    │   ├── UnifiedEditView.vue     # 统一视图编辑模式
    │   └── EditReentryDialog.vue   # 重入编辑选择框（继续编辑/重新开始）
    ├── JumpFloater.vue
    ├── SaveDialog.vue
    ├── ExportDialog.vue            # 多格式导出选择（IDML/PDF/DOCX/HTML/MD/TXT）
    ├── SettingsDrawer.vue          # ⚙️ 设置抽屉面板（§11.5）
    └── ExportCompleteDialog.vue    # 导出完成后的行为选择框
```

---

## 13. 跨窗口通信与会话管理

### 13.1 消息协议

| 场景 | 方向 | 机制 |
|------|------|------|
| **初始加载** | 选择页 → 报告页 | 报告窗口 `ready` → 选择页 postMessage 发送 diff 数据 |
| **大数据** | 双向 | >500KB 时 localStorage 中转 |
| **数据持久化** | — | localStorage 绑定 sessionId，刷新可恢复 |
| **编辑回传** | 报告页 → 选择页 | 报告窗口 postMessage 编辑状态 |
| **心跳** | 报告页 → 选择页 | 每 2 秒，3 次超时判失联 |
| **窗口关闭** | 报告页 → 选择页 | beforeunload → `closing` 消息 |
| **安全** | 双向 | 所有消息验证 `event.origin === window.location.origin` |

### 13.2 多窗口管理

**策略：替换旧窗口 + 安全确认**

选择页打开报告页使用固定 `window.name`（如 `idml-report`），确保新对比结果覆盖旧窗口。

```
选择页点 [对比]
  │
  ├─ 检查是否有已打开报告窗口（window.open 引用 / window.name 匹配）
  │
  ├─ 无 → 直接开新窗口
  │
  └─ 有 → 检测旧窗口是否有未保存编辑
          ├─ 有未保存 → 弹确认框
          │   ┌─────────────────────────────────────────┐
          │   │  当前报告页有未保存的编辑内容              │
          │   │  开始新对比将丢失这些编辑。确定继续？        │
          │   │                                         │
          │   │         [取消]      [确定]                │
          │   └─────────────────────────────────────────┘
          │   ├─ 取消 → 无操作
          │   └─ 确定 → 再弹二次确认
          │       ┌─────────────────────────────────────────┐
          │       │  是否先为当前编辑创建一个备份？            │
          │       │                                         │
          │       │     [跳过]      [先备份再继续]            │
          │       └─────────────────────────────────────────┘
          │       ├─ 跳过 → 关闭旧窗口，开新窗口
          │       └─ 先备份 → 触发手动备份 → 关闭旧窗口，开新窗口
          │
          └─ 无未保存 → 直接关闭旧窗口，开新窗口

新对比开始 → 生成新 sessionId → 归档旧会话（保留 24h）
```

### 13.3 会话管理（SessionId 绑定存储）

每次对比生成唯一 `sessionId`（UUID v4），所有前端状态绑定到此会话。

#### 13.3.1 localStorage 键名规范

```
idml_session_current                  → 当前活跃 sessionId（字符串，始终只有1个）

// 活跃会话数据（绑定 sessionId）
idml_sess_{sessionId}_diff            → 对比数据（segments + contexts + 原文）
idml_sess_{sessionId}_autosave        → 编辑自动保存（html + text + timestamp）
idml_sess_{sessionId}_backup_meta     → 备份元数据（备份时间戳、文件路径列表）
idml_sess_{sessionId}_view_state      → 视图状态（当前视图/搜索/侧边栏状态）
idml_sess_{sessionId}_edit_state      → 编辑状态（是否在编辑中、baseline快照）

// 归档会话（24h 内可恢复）
idml_sess_archive_{sessionId}_diff    → 归档的对比数据
idml_sess_archive_{sessionId}_autosave → 归档的编辑数据
```

#### 13.3.2 生命周期

| 事件 | 行为 |
|------|------|
| **新对比开始** | 生成新 sessionId；归档当前会话（`_sess_` → `_sess_archive_`）；清理过期归档（>24h） |
| **页面刷新** | 读取 `idml_session_current` → 恢复对应会话数据 |
| **报告页关闭** | 选择页收到 `closing` → 如果无未保存编辑，清理活跃会话 |
| **用户手动清理** | 设置页「清除所有缓存」→ 清空所有 `idml_` 前缀的 localStorage 键 |
| **备份 HTML 文件** | 不受 localStorage 清理影响——磁盘文件独立存在 |

### 13.4 崩溃恢复

```
浏览器崩溃 / 进程被杀 / 意外关闭
  │
  ├─ 用户重新打开页面
  │
  ├─ 读取 idml_session_current → 获取上次 sessionId
  │
  ├─ 读取 idml_sess_{sessionId}_autosave
  │   ├─ 存在且 timestamp 距现在 < 5 分钟 → 弹出恢复框
  │   │   ┌─────────────────────────────────────────┐
  │   │   │  检测到未完成的编辑                       │
  │   │   │  最后编辑时间：2026-07-17 11:20            │
  │   │   │                                         │
  │   │   │   ● 恢复编辑                             │
  │   │   │     回到上次编辑位置继续                    │
  │   │   │                                         │
  │   │   │   ○ 放弃编辑                             │
  │   │   │     从原始对比报告重新开始                  │
  │   │   │                                         │
  │   │   │           [确定]                         │
  │   │   └─────────────────────────────────────────┘
  │   │
  │   │   ├─ 恢复编辑 → 加载 autosave + 进入编辑模式
  │   │   │             （不触发新的自动备份，沿用首次备份）
  │   │   └─ 放弃编辑 → 丢弃 autosave，从原始报告加载
  │   │
  │   └─ 不存在或超过 5 分钟 → 直接加载原始对比报告
  │
  └─ 自动备份文件（磁盘上的 HTML）不受影响，始终可访问
```

### 13.5 消息类型定义

```typescript
// 选择页 → 报告页
type MainToReport =
  | { type: 'diff-data'; sessionId: string; segments: Segment[]; contexts: ChangeContext[]; originalText: string; modifiedText: string; fileA: FileInfo; fileB: FileInfo }
  | { type: 'shutdown-request' }  // 要求报告页关闭（多窗口替换前）

// 报告页 → 选择页
type ReportToMain =
  | { type: 'ready' }
  | { type: 'closing'; hasUnsavedEdits: boolean }
  | { type: 'heartbeat' }
  | { type: 'edit-state'; isEditing: boolean; lastEditTime: number };
```

---

## 14. 编辑模式与保存逻辑

### 14.1 三层保存 + 三方 Diff 策略

| 层级 | 触发方式 | 目标 | 延迟 |
|------|----------|------|------|
| L1 自动 | 停止输入 | localStorage | 800ms debounce |
| L2 自动 | L1 成功后 | 服务端 `/api/autosave` | 5s 静默 |
| L3 手动 | 点击「💾 保存更改」 | 服务端 `/api/autosave` | 即时 |
| 备份 L0 | 首次进编辑（自动）/ 工具栏按钮（手动） | 服务端 `/api/backup` + 本地 HTML | 即时 |
| 导出 | 点击「📥 导出」 | 服务端按格式导出 | 即时下载 |

### 14.2 编辑前备份机制

```
┌──────────────────────────────────────────────────────────────┐
│                        备份工作流                              │
│                                                              │
│  查看模式                                                      │
│     │                                                        │
│     ├─ [编辑] 首次 → 自动备份 ──→ 进入编辑                      │
│     │   │         ├─ 服务端 JSON 快照 (/api/backup)            │
│     │   │         └─ 本地 HTML (project/backups/*.html)        │
│     │   │                                                    │
│     │   └─ 备份失败 → 阻止进入编辑，弹窗提示错误                   │
│     │                                                        │
│     ├─ [编辑] 非首次 → 弹出"继续编辑/重新开始"选择框               │
│     │   │         ├─ 继续：恢复 autosave + localStorage 状态     │
│     │   │         └─ 重来：丢弃编辑，重载报告，不创建新备份          │
│     │   │                                                    │
│     │   └─ 无论选哪个：初始自动备份 🔒 永久保留                    │
│     │                                                        │
│     └─ [📋 备份] 按钮（工具栏，随时可用）                         │
│           └─ 即时创建新备份 → toast "备份已完成"                  │
│              ├─ 命名：2026-07-17_14-30-05_391对比报告.html       │
│              ├─ 服务端 JSON 快照                                │
│              └─ 本地 HTML 文件                                 │
│                                                              │
│  备份存储                                                       │
│     ├─ 服务端：JSON 序列化完整报告状态                            │
│     ├─ 本地：project/backups/（路径可在设置中修改）                │
│     └─ 管理：无备份面板；设置页「清除所有备份」手动清理              │
└──────────────────────────────────────────────────────────────┘
```

### 14.3 Patch 增量追踪 + 两层叠加机制

**对比旧方案（classifyOps 全量 re-diff）：**

| | classifyOps（旧） | Patch + 两层叠加（新） |
|---|---|---|
| **追踪方式** | 每次编辑全量 re-diff 当前 vs 基线 | `patch_make(baseline, current)` 仅产出增量 Patch |
| **性能** | O(n·m) 全文对比，大文档慢 | O(编辑区间) 增量，远小于全文 |
| **分类** | 逐个字符判断 origin=original 还是 user | 不需要分类——两层独立渲染 |
| **重叠处理** | 编辑与原始差异重叠时分类模糊 | 用户层不透明覆盖原始层——用户编辑过的字符仅显示用户颜色，不显示原始标记 |

**工作机制：**

1. 进入编辑模式时，将当前文本保存为**基线快照**（`baseline`）
2. 每次编辑触发后（800ms debounce），调用 `patch_make(baseline, current)` → 得到 `Patch[]` 增量列表
3. **原始差异层**：基于初始 `segments` 渲染，始终不变，只读
4. **用户编辑层**：基于 Patches 渲染，**不透明覆盖**在原始差异层上方（用户触碰过的字符仅显示用户颜色，原始标记被完全遮挡）
5. 两层的 CSS z-index 不同，用户编辑层在上；用户可独立开关每层
6. 导出 PDF 时，两层同时渲染到打印 HTML 中，形成完整标注
7. **撤销时颜色还原**：如果被编辑的字符原本有原始 diff 标记，撤销后恢复原始标记颜色；如果原本无标记，撤销后恢复为纯文本

### 14.4 恢复机制

- 页面加载时通过 `idml_session_current` 查找会话，读取 `idml_sess_{sessionId}_autosave`
- 如果有 5 分钟以内的未完成编辑 → 弹出恢复对话框（「恢复编辑」或「放弃编辑」）
- 选择「恢复编辑」→ 进入编辑模式，不触发自动备份（沿用首次备份）
- 选择「放弃编辑」→ 丢弃 autosave，从原始对比报告重新加载
- 超过 5 分钟的残留数据自动清理
- **备份不受恢复机制影响**：磁盘上的 HTML 备份文件和初始自动备份始终保留
- 详见 §13.4 崩溃恢复流程

---

## 15. 搜索功能

### 15.1 搜索栏

| 控件 | 功能 |
|------|------|
| **搜索框** | 工具栏内嵌 SearchBar.vue，支持实时输入搜索 |
| **快捷键** | Ctrl+F 激活搜索框并聚焦 |
| **结果计数** | '第 N/M 个匹配' 实时显示 |
| **关闭** | Escape 或点击 × 关闭搜索，清除所有高亮 |

### 15.2 高级搜索选项

搜索栏展开后显示高级选项面板：

| 选项 | 类型 | 说明 |
|------|------|------|
| **区分大小写** (Aa) | 开关 | 默认关闭，开启后严格匹配大小写 |
| **全词匹配** (ab) | 开关 | 默认关闭，开启后 '社' 不匹配 '社会' |
| **差异类型过滤** | 多选标签 | 可选筛选范围：新增 / 删除 / 修改 / 格式变更 / 用户编辑 / 纯文本。至少选一项，默认全选 |
| **替换** | 输入框 + 按钮 | 仅编辑模式下可用。输入替换文字，支持「替换」「全部替换」。替换操作遵循用户编辑颜色覆盖规则 |

### 15.3 跨视图搜索行为

| 视图 | 行为 |
|------|------|
| **统一视图** | 单栏中高亮所有匹配项，Enter 按文档流向下跳转 |
| **分栏视图** | **双栏同时高亮**——左侧和右侧匹配文字同时标注；Enter 导航按**文档流自然顺序**遍历（与统一视图的遍历顺序一致，分栏仅是视觉布局） |
| **编辑模式** | 搜索行为同上，额外规则见 §15.4 |

### 15.4 编辑模式搜索规则

| 场景 | 行为 |
|------|------|
| **覆盖层搜索** | 被用户编辑不透明覆盖的底层原始文字**依然可被匹配**，高亮显示在当前可见层上 |
| **用户删除内容** | 编辑时被删文字（紫色 user-del 标记）仍可被搜索匹配，高亮叠加在删除标记上 |
| **用户新增内容** | 用户新增文字（琥珀 user-add 标记）正常参与搜索匹配 |
| **替换操作** | 编辑模式下替换文本遵循用户编辑颜色覆盖规则——替换产生的文字标注为用户编辑颜色，被替换掉的文字转为 user-del 标记 |

### 15.5 虚拟滚动与导航

| 场景 | 行为 |
|------|------|
| **自动滚动** | Enter 跳转时虚拟列表自动滚动到匹配位置，搜索结果居中可见 |
| **聚焦高亮** | 当前聚焦匹配：橙色背景 (`#fff3cd`) + 4px 红色边框 + 脉冲动画 |
| **非聚焦匹配** | 其余匹配：黄色背景 (`--search-highlight: #fff9c4`) |
| **侧边栏匹配列表** | 搜索时侧边栏切换为「搜索结果」面板，列出所有匹配项（含上下文摘要 + 差异类型标签），点击跳转 |
| **键盘导航** | Enter / Shift+Enter 前后跳转搜索结果；J/K 键仅在非搜索状态导航差异 |
| **跳转浮标** | 跳转时屏幕中央短暂浮现匹配摘要 |

### 15.6 颜色约定

| 样式 | CSS 变量 | 值 |
|------|----------|-----|
| 搜索高亮（非聚焦） | `--search-highlight` | `#fff9c4` |
| 搜索聚焦 | — | `#fff3cd` 背景 + 4px `#e60000` 边框 + 脉冲动画 |
| 用户删除上的搜索高亮 | — | 高亮黄底叠加在紫色 user-del 背景上，边框不变 |

---

## 16. 错误处理

| 场景 | 处理 |
|------|------|
| IDML ZIP 解压失败 / XML 解析失败 | 弹窗具体错误 |
| Diff 超时（>1s 默认 timeout） | 降级粗粒度 diff |
| postMessage 被拦截 | 降级 localStorage 轮询 |
| window.open 被拦截 | 提示允许弹窗 |
| 报告窗口意外关闭 | 主页面提示 + 保留编辑备份 |
| Vue 组件渲染异常 | onErrorCaptured → 友好错误页面 + 重新加载 |
| 导出操作异常 | try/catch 保护所有导出函数 |
| Playwright 启动失败 | 提示检查 Node.js 和 Chromium 安装 |
| 服务端 autosave 失败 | 前端提示 + localStorage 兜底 |
| 备份失败（磁盘满/服务端不可达） | 阻止进入编辑模式，弹窗提示具体原因 |
| 备份目录不存在 | 自动创建 backups/ 目录，失败则弹窗提示 |
| localStorage 已满 | 降级策略：仅保留当前会话数据，清理归档会话 |
| 报告窗口被浏览器拦截 | 提示用户允许弹窗 |
| 报告窗口意外关闭（beforeunload 未触发） | 心跳超时 6 秒后选择页判定失联，保留 autosave 数据 |
| 多个报告窗口同时存在（意外场景） | 以最新 sessionId 为准，旧窗口心跳超时后忽略 |
| API 超时/网络错误 | 重试机制 + 用户提示 |

---

## 17. 非功能性需求

### 17.1 性能

| 指标 | 要求 |
|------|------|
| **解析+对比时延** | 无硬性死线；必须显示实时进度（已解析 X 字/预估 Y 秒），让用户感知系统在工作 |
| **流式渲染** | NDJSON 分段传输，前 3 个 chunk 到达即渲染首屏，无需等待全量数据 |
| **滚动流畅度** | 60fps，虚拟滚动确保任何文档大小下恒定帧率 |
| **编辑响应** | contentEditable + 800ms debounce；patch_make O(编辑区间) 增量，不随文档增大变慢 |
| **PDF 生成** | Playwright + Paged.js 单进程渲染，50 页以内 <30s |
| **首次内容绘制 (FCP)** | 服务端完成首批 chunk diff 后即可开始渲染，预计 <2s 可见首屏 |

### 17.2 内存架构（分段流式 + IndexedDB）

```
服务端 Diff ──→ NDJSON 流式传输 ──→ 前端 IndexedDB 持久层 ──→ 虚拟滚动视窗渲染

┌──────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│ 服务端边算边推      │     │ IndexedDB         │     │ JS 运行时（视窗）    │
│ chunked response  │ ──→ │ segments chunk 0  │ ←── │ 当前视窗 ~100 条    │
│ 每 chunk ≈500条   │     │ segments chunk 1  │     │ 前缓冲  ~50 条      │
│ segments           │     │ segments chunk 2  │     │ 后缓冲  ~50 条      │
│                    │     │ ...               │     │ 总计 ≤200 segments  │
│                    │     │ 容量：浏览器允许    │     │ 内存恒定 <50MB      │
└──────────────────┘     └──────────────────┘     └────────────────────┘
```

| 措施 | 效果 |
|------|------|
| **IndexedDB 分段存储** | Segments 不存 JS 堆，存 IndexedDB；虚拟滚动按需读取 |
| **虚拟滚动** | DOM 节点恒定 <5MB，仅渲染可视区 + 缓冲区 |
| **文本去重** | 原文/修改版文本各存一份，Segment 引用 offset 而非复制字符串 |
| **流式传输** | 首批 chunk 到达即渲染，无需等待全量；边传边写 IndexedDB |
| **会话清理** | 关闭报告页或新对比开始 → 清理对应 IndexedDB，不残留 |
| **预估内存** | JS 堆恒定 <50MB（IndexedDB 不计入 JS 堆） |

### 17.3 浏览器兼容性

| 浏览器 | 要求 |
|------|------|
| **Chrome 90+** | 完整支持所有功能 |
| **Edge 90+** | 完整支持所有功能 |
| **Firefox 90+** | 完整支持所有功能——ContentEditable / CSS Grid / Virtual Scroll / IndexedDB / Writing Mode 均需与 Chrome 行为一致，差异视为 bug |

### 17.4 安全

| 措施 | 说明 |
|------|------|
| **postMessage origin 校验** | 所有跨窗口消息验证 `event.origin === window.location.origin` |
| **无 eval** | 不使用 `eval()` / `new Function()` |
| **粘贴纯文本清洗** | 粘贴事件强制 `text/plain`，阻止 HTML/富文本注入 |
| **API 文件系统越权** | 服务端仅允许访问 IDML 临时目录，路径穿越拒绝 |
| **IndexedDB 隔离** | 按 sessionId 前缀隔离，跨会话不可访问 |

### 17.5 主题与无障碍

| 类别 | 要求 |
|------|------|
| **主题** | 仅亮色模式；4 套预设主题可选（默认/暖色/高对比度/柔光） |
| **无障碍** | ARIA 标签标注 / 键盘全操作 / 焦点管理 / 高对比度主题支持 WCAG AA 级 |
| **离线** | 全部依赖内嵌，构建后不依赖 CDN |

### 17.6 文件大小

| 限制 | 值 |
|------|------|
| **最大 IDML 文件** | 2GB |
| **内存警告阈值** | 预估文本 >100MB 时黄条提示；>500MB 时红条警告，均提供「仍然继续」选项 |
| **不设硬限制** | 内存由 IndexedDB 兜底，JS 堆恒定，不因文件大而 OOM

---

## 18. 已知限制

| 限制 | 影响 | 状态 |
|------|------|------|
| 不支持文本框旋转/渐变/特效 | IDML 含此特性的视觉效果丢失 | 不计划支持 |
| 不支持图片/表格/页眉页脚/脚注/批注 | 仅对比正文文本内容 | 不计划支持 |
| 字体嵌入无子集化 | 字体文件可能较大（几 MB~几十 MB），完整嵌入不裁剪 | 可接受 |
| PDF 大文档渲染 | Playwright 单进程渲染，超 50 页可能较慢（预估 >30s） | 待监控 |
| 编辑模式大文档 | >5000 字符内容可编辑性略有延迟 | 可接受 |
| IndexedDB Quota | 部分浏览器 IndexedDB 上限为磁盘空间的 60%，极少数场景可能不足 | 低风险 |
| Firefox 兼容性 | ContentEditable/CSS Grid/IndexedDB 行为在 Firefox 上需实测验证 | 待测试 |
| 跨格式对比 | 不支持 IDML vs DOCX 等跨格式对比 | 不计划支持 |

---

## 19. 依赖清单

### 19.1 Python (requirements.txt)

| 库 | 版本 | 用途 |
|----|------|------|
| diff-match-patch | ≥20230430 | Diff 引擎（google-diff-match-patch Python 版） |
| fpdf2 | ≥2.7 | PDF 创建（封存方案，当前不参与主流程） |
| pypdf | ≥5.0 | PDF 元数据读取（被 pdf_toolkit 封装） |
| pdfplumber | ≥0.10 | PDF 文本提取/验证（被 pdf_toolkit 封装） |
| (标准库) | — | http.server, subprocess, threading, json, re, tempfile, zipfile, xml |

### 19.2 Node.js (package.json)

| 包 | 版本 | 用途 |
|----|------|------|
| playwright | ^1.x | 无头 Chromium，PDF 渲染（替代 Puppeteer） |
| pagedjs | ^0.4 | CSS Paged Media polyfill，分页控制 |
| vue | ^3.4 | 前端框架 |
| vite | ^5.x | 构建工具 |
| typescript | ^5.x | 类型系统 |
| jszip | ^3.10 | IDML ZIP 读取（前端辅助） |
| vitest | ^2.x | 前端单元测试 + 组件测试 |
| @vue/test-utils | ^2.x | Vue 组件测试工具 |

### 19.3 Python 测试依赖

| 库 | 版本 | 用途 |
|----|------|------|
| pytest | ≥8.x | Python 单元测试框架 |
| pytest-cov | ≥5.x | 测试覆盖率报告 |

### 19.4 运行时要求

| 组件 | 版本 | 路径 |
|------|------|------|
| Python | 3.13.12 | `~/.workbuddy/binaries/python/versions/3.13.12/python.exe` |
| Node.js | 22.22.2 | `~/.workbuddy/binaries/node/versions/22.22.2/node.exe` |
| Chromium | bundled | Playwright 自动下载 |

---

## 20. 技术决策记录

### ADR-1：前后端分离架构

- **决策**：Vue 3 + TypeScript 前端 / Python API 后端
- **原因**：前端需要复杂 UI（双窗口、编辑模式、8 色标记），Vue 3 组件化 + TypeScript 类型安全更适合；IDML 解析和 PDF 渲染需要服务端算力
- **代价**：增加前后端通信开销，需要维护两套代码

### ADR-2：Diff 引擎选型

- **决策**：google-diff-match-patch (Python 版) 替代自研 difflib/自研 LCS
- **原因**：成熟开源库，字符级精度 + 语义清理 + patch 生成，久经考验；避免维护自研算法的长期成本
- **代价**：引入额外依赖，Python 版运行在服务端

### ADR-3：PDF 引擎选型

- **决策**：Playwright + Paged.js 替代 fpdf2（再替代旧版 Puppeteer）
- **原因**：fpdf2 CSS 支持有限，无法渲染完整 HTML 报告；Playwright 相比 Puppeteer API 更现代、维护更活跃、支持 tagged PDF；Paged.js 提供 CSS Paged Media 分页控制
- **代价**：引入 Node.js 依赖，增加 ~300MB Chromium 下载

### ADR-4：保存 vs 导出分离

- **决策**：「💾 保存更改」「📥 导出PDF」「📄 写回IDML」为独立按钮
- **原因**：保存 = 持久化存储（autosave），导出/写回 = 生成可下载文件

### ADR-5：自动保存策略

- **决策**：localStorage (800ms) → 服务端 (5s) 双层
- **原因**：localStorage 即时响应 + 服务端持久化，防止浏览器崩溃丢失数据

### ADR-6：三方 Diff 编辑标记

- **决策**：Patch 增量追踪 + 两层叠加渲染（用户层不透明覆盖原始层），替代 classifyOps 全量 re-diff 分类
- **原因**：classifyOps 每次编辑全量 re-diff，大文档性能差；编辑与原始差异重叠时分类模糊。Patch 方案仅追踪用户编辑区间的增量；用户层采用不透明覆盖——被编辑过的字符仅显示用户颜色，原始标记被完全遮挡。覆盖规则详见 §8.3.2
- **代价**：需实现 Patch → DOM 渲染转换；两层 z-index 管理 + 覆盖逻辑增加 CSS 复杂度；撤销时需正确处理颜色还原（有原始标记的恢复原始颜色，无标记的恢复纯文本）

### ADR-7：预设配色主题

- **决策**：提供 4 套预设配色主题（默认/暖色/高对比度/柔光），通过 `data-theme` 属性切换 CSS 变量，不开放自由调色
- **原因**：自由调色增加 UI 复杂度且用户决策负担大；预设主题覆盖主要使用场景（日常对比/无障碍/长时间阅读），CSS 变量体系保留高级用户手动覆盖能力
- **4 套主题**：默认（红绿分明）/ 暖色（大地色调）/ 高对比度（饱和清晰，无障碍）/ 柔光（护眼低刺激）
- **切换方式**：工具栏设置菜单下拉选择，localStorage 持久化

### ADR-8：跨窗口通信

- **决策**：postMessage + origin 校验 + localStorage 中转大数据
- **原因**：选择页和报告页独立窗口，需要可靠通信；localStorage 解决大数据传递和刷新恢复

### ADR-9：Puppeteer → Playwright + Paged.js 迁移

- **决策**：PDF 渲染从 Puppeteer 迁移至 Playwright + Paged.js
- **原因**：Playwright API 更现代、维护更活跃、支持 tagged PDF（无障碍）；Paged.js 提供 CSS Paged Media 精确分页控制（`@page` 规则、页眉页脚、页码）
- **代价**：需重写 `puppeteer_pdf.cjs` → `playwright_pdf.cjs`，HTML 模板需适配 Paged.js 语法

### ADR-10：编辑模式直接导出

- **决策**：编辑模式工具栏直接提供 [📥 导出PDF] 和 [📄 写回IDML] 按钮
- **原因**：原方案需要先保存再从 SaveDialog 导出，多了一步操作。编辑模式下直接导出更符合工作流直觉，且导出的 PDF 包含完整标注（原始差异 + 用户编辑两层）
- **代价**：编辑模式工具栏按钮增多，需做好视觉区分

### ADR-11：双视图模式（分栏视图 + 统一视图）

- **决策**：查看模式下同时提供分栏视图和统一视图，通过工具栏按钮组一键切换
- **原因**：
  - 分栏视图：适合逐行精确比对，原文/修改左右并排对齐，符合传统文档审阅习惯（参考 Word 审阅模式）
  - 统一视图：适合快速浏览整体变更，单一文本流连续阅读体验更好（参考 Git diff / diff-match-patch 标准视图）
  - 两种视图面向不同使用场景，二者互补而非替代
- **实现要点**：
  - 分栏视图使用 CSS Grid 双栏布局 + 中间分隔线，左右虚拟滚动完全同步
  - 统一视图复用现有内联差异渲染管线，新增双行号标注（原文/修改版）
  - 视图切换瞬间完成（翻页动画 transition），不重新请求 diff 数据
  - 编辑模式下同样支持视图切换（分栏编辑仅可编辑右侧修改版）
- **参考产品**：Compare2Word（compare2word.com）的分栏/统一视图切换交互模式

### ADR-12：编辑前自动备份 + 多格式导出

- **决策**：首次进入编辑模式时自动备份完整对比报告（服务端 JSON + 本地 HTML），后续进入不再自动备份；手动备份不受限制
- **原因**：
  - 用户编辑前需要一份可回溯的对比结果快照，防止编辑操作不可逆
  - 服务端 + 本地双备份保证可靠性：服务端持久化，本地 HTML 可离线查看
  - 仅首次自动备份避免目录膨胀，手动备份满足额外需要
- **重入策略**：
  - 非首次进入编辑时弹出选择框（继续编辑 / 重新开始）
  - 继续编辑：从 autosave 恢复；重新开始：丢弃编辑，不创建新备份
  - 初始备份永久保留，不被任何操作覆盖或清理
- **导出策略**：
  - PDF 保留双层标注（原始 diff + 用户编辑）；DOCX 保留排版但无标注；HTML/MD/TXT 纯文本
  - 导出后弹窗询问"留在编辑模式还是返回查看模式"
  - 导出生成新文件，不覆盖原始对比结果
- **备份安全**：备份失败阻止进入编辑，确保用户不会在没有安全网的情况下编辑
- **参考产品**：Word「另存为」+ Git stash 逻辑结合的备份思路

### ADR-13：分段流式 + IndexedDB 内存架构

- **决策**：前端不将全量 segments 加载到 JS 内存，改为 NDJSON 分段传输 + IndexedDB 持久层 + 虚拟滚动按需渲染
- **原因**：
  - 2GB IDML 上限意味着文本可能达数百 MB，全量加载到 JS 堆会导致 OOM
  - IndexedDB 由浏览器管理，容量远大于 JS 堆（通常数百 MB~数 GB），且不计入 JS 内存
  - 流式传输实现边算边看——首批 chunk 到达即渲染，无需等待全量 diff 完成
- **架构**：服务端 NDJSON chunked response → 前端 IndexedDB 分段写入 → 虚拟滚动按视窗读取（≤200 segments/视窗）→ JS 堆恒定 <50MB
- **代价**：实现复杂度增加（IndexedDB 读写封装 + chunk 管理 + 会话清理）；离线需处理 IndexedDB quota 边界

---

## 21. 文件索引

> 以下为目标规划结构，标注 🟢 已实现 / 🟡 需改造 / 🔴 待实现

```
D:/Desktop/IDML/
├── .gitignore                          # 🟢 Git 排除规则
├── .env.example                        # 🟢 环境变量模板
├── package.json                        # 🟡 需扩展：加 vue/vite/typescript/vite 依赖
├── requirements.txt                    # 🟡 需扩展：加 diff-match-patch
├── start.bat                           # 🟡 需改造：自动安装+全功能参数启动脚本
├── 391原.idml / 391修改.idml            # 🟢 测试文档（冒烟测试）
├── vite.config.ts                      # 🔴 Vite 多页面配置
├── tsconfig.json                       # 🔴 TypeScript 配置
│
├── index.html                          # 🔴 选择页入口
├── report.html                         # 🔴 报告页入口
│
├── src/                                # 🔴 前端源码
│   ├── main.ts                         # 选择页 Vue 入口
│   ├── report.ts                       # 报告页 Vue 入口
│   ├── types/index.ts                  # Segment, ChangeContext 等
│   ├── render/                         # 查看/编辑 HTML 构建 + 光标管理
│   ├── export/                         # PDF/IDML/DOCX 多格式导出
│   ├── components/
│   │   ├── select-page/                # 选择页组件
│   │   └── report-page/                # 报告页组件（见 §12 完整组件树）
│   ├── utils/
│   │   ├── postmessage.ts              # 跨窗口通信
│   │   ├── storage.ts                  # localStorage 封装
│   │   ├── session.ts                  # 会话管理
│   │   ├── backup.ts                   # 备份管理
│   │   └── indexeddb.ts                # IndexedDB 分段存取封装
│   └── styles/                         # CSS 变量 + 4 套主题
│
├── .workbuddy/
│   └── scripts/
│       ├── idml_gui.py                 # 🟡 需改造：API 化 + NDJSON 流式
│       ├── diff_engine.py              # 🔴 NDJSON 流式 diff + 永不超时
│       ├── idml_parser.py              # 🟡 需改造：严格模式 + 精确过滤 + 字体提取
│       ├── idml_pdf.py                 # 🟡 需改造：Playwright + Paged.js 管道
│       ├── idml_writer.py              # 🟢 解包→替换→重新打包，保留全资源
│       ├── backup_manager.py           # 🔴 服务端 JSON 备份序列化/清理
│       ├── config_loader.py            # 🟢 .env 配置加载
│       ├── playwright_pdf.cjs           # 🔴 Playwright + Paged.js 渲染引擎
│       ├── pdf_toolkit.py              # 🟢 pypdf/pdfplumber/fpdf2 封装层
│       ├── idml_diff.py                # 🟢 CLI diff 工具 (独立)
│       ├── idml_pdf_v20260716.py       # 🟢 [封存] fpdf2 渲染引擎
│       ├── puppeteer_pdf.cjs           # 🟡 [待迁移] → playwright_pdf.cjs
│       └── pdf_toolkit_v20260716.py    # 🟢 [封存] pdf_toolkit 历史版本
│
├── docs/
│   ├── IDML对比工具-需求技术文档.md     # 🟢 本文档
│   ├── system_design.md               # 🟢 系统设计文档
│   ├── class-diagram.mermaid           # 🟢 类图
│   └── sequence-diagram.mermaid        # 🟢 时序图
│
├── tests/                               # 🔴 测试
│   ├── unit/
│   │   ├── test_idml_parser.py          # IDML 解析器单元测试
│   │   ├── test_diff_engine.py          # Diff 引擎单元测试
│   │   ├── test_idml_writer.py          # IDML 写回单元测试
│   │   └── test_backup_manager.py       # 备份管理单元测试
│   ├── components/                      # Vue 组件测试
│   ├── e2e/                             # Playwright E2E 测试
│   ├── fixtures/                        # 测试数据（冒烟/边界/压力）
│   └── screenshots/                     # 视觉回归截图
│
└── dist/                               # 🔴 Vite 构建产物
```

---

## 22. 启动与部署

本地桌面应用，双击启动。

### 22.1 系统要求

| 组件 | 最低要求 |
|------|----------|
| **OS** | Windows 10+ / macOS 12+ / Linux (Ubuntu 20.04+) |
| **Python** | 3.13.12（项目内置 managed runtime） |
| **Node.js** | 22.22.2（项目内置 managed runtime） |
| **Chromium** | Playwright 自动下载（~300MB，仅首次） |
| **磁盘** | 至少 500MB（含依赖 + Chromium） |
| **内存** | 推荐 8GB+（对比 2GB 文档建议 16GB） |

### 22.2 快速启动

双击 `start.bat`（Windows）或 `./start.sh`（macOS/Linux）。

**首次运行自动安装：**

```
启动脚本
  │
  ├─ 检测 Python runtime → 缺失则自动安装
  ├─ 检测 Node.js runtime → 缺失则自动安装
  ├─ 检测 npm 依赖 → 缺失则 npm install
  ├─ 检测 pip 依赖 → 缺失则 pip install -r requirements.txt
  ├─ 检测 Chromium → 缺失则 npx playwright install chromium
  │
  ├─ 启动后端（端口 17890）
  │     └─ 等待后端就绪（health check 轮询）
  │
  ├─ 启动前端开发服务器（端口 3000）
  │
  └─ 打开浏览器 → http://localhost:3000
```

### 22.3 启动参数

```bash
start.bat [OPTIONS]

选项：
  --port <port>          后端端口（默认 17890）
  --dev-port <port>       前端开发端口（默认 3000）
  --host <ip>             绑定主机地址（默认 127.0.0.1，仅本机访问）
  --log-level <level>     日志级别：debug | info | warn | error（默认 info）
  --no-auto-install       跳过自动依赖安装
  --no-browser            不自动打开浏览器
  --quiet                 静默模式，不打印安装进度
  --prod                  生产模式（使用 dist/ 构建产物，不启动 dev server）

示例：
  start.bat --port 17891 --host 0.0.0.0     # 允许局域网访问
  start.bat --prod                            # 生产模式
  start.bat --quiet --no-browser              # 后台静默启动
```

### 22.4 生产模式

生产模式下前端使用 Vite 构建产物（`dist/`），后端提供静态文件服务：

```bash
# 构建
npm run build       # → dist/

# 启动（生产模式）
start.bat --prod

# 后端将同时服务：
#   http://localhost:17890/           → dist/index.html（选择页）
#   http://localhost:17890/report.html → dist/report.html（报告页）
#   http://localhost:17890/api/*       → Python API
```

### 22.5 故障排查

| 问题 | 可能原因 | 解决 |
|------|----------|------|
| 端口 17890 被占用 | 上次未正常关闭 | `netstat -ano | findstr 17890` 查占用并关闭 |
| Chromium 下载失败 | 网络问题 | 手动设置 `PLAYWRIGHT_DOWNLOAD_HOST` 或从国内镜像下载 |
| npm install 失败 | Node 版本不匹配 | 使用 `nvm` 切换或等待脚本自动安装 runtime |
| pip install 失败 | Python 版本不匹配 | 使用项目内置 Python runtime |
| 页面白屏 | 前端未构建或后端未启动 | 检查两个终端是否都正常运行；查看 `--log-level debug` 日志 |
| 对比超时无响应 | 文档过大 | 等待进度条；如需终止则关闭终端重新启动 |
| IndexedDB 异常 | 浏览器隐私模式 | 隐私模式下 IndexedDB 可能受限，使用正常模式 |

---

## 23. 测试策略

### 23.1 测试层级

| 层级 | 范围 | 工具 | 目标覆盖率 |
|------|------|------|-----------|
| **单元测试** | `idml_parser.py` / `diff_engine.py` / `idml_writer.py` / `backup_manager.py` / `session.ts` / `storage.ts` | pytest / Vitest | 核心模块 >80% |
| **组件测试** | Vue 组件：ViewToggle / SearchBar / SettingsDrawer / UnifiedView / SplitView / ChangeCardList 等 | Vitest + Vue Test Utils | 报告页组件 >70% |
| **E2E** | 完整流程：上传 → 对比 → 视图切换 → 编辑 → 搜索 → 导出 → 写回 IDML | Playwright | 核心流程 100% |
| **视觉回归** | 4 套主题 × 3 浏览器截图对比 | Playwright screenshot | 关键页面 |
| **压力测试** | 大文件/高变更数场景的渲染性能和内存稳定性 | k6 / 自定义脚本 | 关键指标 |

### 23.2 测试数据体系

#### Layer 1：冒烟测试（已有）

| 数据 | 用途 |
|------|------|
| `391原.idml` / `391修改.idml` | 真实文档核心流程验证 |

#### Layer 2：边界场景

| 编号 | 场景 | 测试目标 |
|------|------|----------|
| `empty_a` / `empty_b` | 两份空文档 | 拒绝逻辑 + 错误提示 |
| `identical` | 两份完全相同 | "完全相同"弹窗 + 零变更统计 |
| `single_char` | 单字差异 | 字符级 diff 精度 |
| `format_only` | 仅字体/颜色/间距变更 | 格式变更检测 |
| `story_count_mismatch` | 原文 3 Stories / 修改版 5 Stories | Story 筛选面板 |
| `special_chars` | emoji、数学符号、不可见字符 | 字符全保留策略 |
| `large_insert` | 修改版插入整段章节（5000+ 字） | 海量新增 + 编辑确认阈值 |
| `large_delete` | 原文整段删除（5000+ 字） | 海量删除 |
| `edit_boundary` | 刚好 5000 字 | 编辑确认阈值边界 |

#### Layer 3：压力测试

| 编号 | 场景 | 测试目标 |
|------|------|----------|
| `stress_100k` | ~10 万字文档对 | 流式传输 + 首屏渲染 FCP<2s |
| `stress_1m` | ~100 万字文档对 | IndexedDB 分段存储 + 内存恒定 <50MB |
| `stress_50_changes` | ~50 处变更 | 自适应导航分组折叠边界 |
| `stress_500_changes` | ~500 处变更 | 热力图切换边界 + 侧边栏性能 |
| `corrupted_zip` | 损坏的 ZIP | 严格模式错误提示 |
| `missing_story` | 缺少 Story 文件 | XML 解析错误 + 文件名/行号提示 |
| `embedded_fonts` | 含内嵌字体 | 字体提取 + @font-face 引用 |
| `all_filtered` | 全部非正文（脚注/目录/索引） | 精确过滤 + 空结果提示 |

### 23.3 E2E 核心流程

```
1. 选择页
   ├─ 拖拽上传 391原.idml + 391修改.idml
   ├─ 格式校验：非 .idml 拒绝、>2GB 拒绝
   └─ 点击对比 → 进度条 → 开报告页

2. 报告页查看
   ├─ 默认统一视图渲染
   ├─ 视图切换：统一 ↔ 分栏
   ├─ 侧边栏：统计卡片 + 变更列表 + 点击跳转
   ├─ 搜索：Ctrl+F → 输入 → 高级选项 → 类型过滤 → 替换
   └─ 导出 PDF（查看模式）

3. 报告页编辑
   ├─ 点击 [编辑] → 自动备份 → 进入编辑
   ├─ 文本编辑 → 颜色覆盖规则（原始标记 vs 用户编辑）
   ├─ 撤销/重做 → 颜色还原
   ├─ 手动备份 → toast 确认
   ├─ 多格式导出（IDML/PDF/DOCX/HTML/MD/TXT）
   └─ 写回 IDML → 下载新 IDML → 用 InDesign 验证可打开

4. 会话与恢复
   ├─ 关闭报告页 → 选择页自动刷新
   ├─ 模拟崩溃 → 重新打开 → 恢复编辑
   └─ 新对比 → 多窗口检测 → 安全确认
```

### 23.4 CI/CD 集成

| 触发条件 | 执行 |
|------|------|
| **每次 PR** | 单元测试 + 组件测试 |
| **合并到 main** | 单元测试 + 组件测试 + E2E（核心流程） |
| **发布前** | 全部测试 + 视觉回归 + 压力测试 |
| **夜间** | 压力测试 + 长稳测试（大文件解析不泄漏） |

---

*文档由 IDML 对比工具团队自动生成于 2026-07-16*
*基于 D:/Desktop/IDML/docs/IDML对比工具-需求技术文档.md 与 doc-compare/TECHNICAL.md 融合*
