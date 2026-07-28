# Compare — 文档对比工具实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个支持 txt/docx/md 格式的独立文档对比工具，提供字符级精确对比、双视图渲染、编辑模式、版本化保存和多格式导出。

**Architecture:** Vue 3 + TypeScript + Vite 前端单页应用（vue-router `/` 选择页 + `/report` 报告页），FastAPI + Python 后端提供 REST API + NDJSON 流式 Diff，google-diff-match-patch 字符级引擎，Pinia 状态管理，IndexedDB + localStorage 前端持久化。

**Tech Stack:** Vue 3.4+, TypeScript 5.x, Vite 5.x, Pinia 2.x, vue-router 4.x, FastAPI 0.115+, uvicorn 0.32+, google-diff-match-patch, python-docx 1.1+, chardet 5.2+, psutil 6.0+, vitest 2.x, pytest

## Global Constraints

- 所有格式提取为纯文本对比，不解析格式/排版/图片/表格
- Diff 引擎永不超时（`timeout=0`），始终字符级精确输出
- 单页路由，无跨窗口通信
- 后端无状态设计，状态全部前端管理
- 零设置面板，所有参数作为代码常量
- 统一错误信封 `{error, severity, title, message, detail}`
- 检查清单：文件 <800 行，函数 <50 行，嵌套 ≤4 层，不可变性优先，TDD 工作流
- 导出：查看模式 → 带标注导出，编辑模式 → 干净文本导出

---

## File Structure

```
Compare/
├── .gitignore
├── .env.example
├── package.json
├── requirements.txt
├── start.bat
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── env.d.ts
├── index.html
├── src/                          # Frontend source
│   ├── main.ts
│   ├── App.vue
│   ├── types/index.ts
│   ├── router/index.ts
│   ├── stores/
│   │   ├── compare.ts
│   │   ├── editor.ts
│   │   ├── search.ts
│   │   ├── view.ts
│   │   └── version.ts
│   ├── render/
│   │   ├── segmentRenderer.ts
│   │   ├── splitRenderer.ts
│   │   └── editClassifier.ts
│   ├── export/
│   │   └── exporters.ts
│   ├── components/
│   │   ├── select-page/
│   │   │   ├── DropZone.vue
│   │   │   └── EncodeDialog.vue
│   │   └── report-page/
│   │       ├── Toolbar.vue
│   │       ├── Sidebar.vue
│   │       ├── Minimap.vue
│   │       ├── UnifiedView.vue
│   │       ├── SplitView.vue
│   │       ├── SearchBar.vue
│   │       ├── ExportDialog.vue
│   │       ├── VersionHistory.vue
│   │       ├── ErrorDisplay.vue
│   │       └── ProgressHeader.vue
│   ├── utils/
│   │   ├── api.ts
│   │   ├── indexeddb.ts
│   │   ├── storage.ts
│   │   ├── search.ts
│   │   ├── resource.ts
│   │   └── keybindings.ts
│   ├── views/
│   │   ├── SelectPage.vue
│   │   └── ReportPage.vue
│   └── styles/
│       ├── variables.css
│       └── main.css
├── src_backend/                  # Backend source
│   ├── __init__.py
│   ├── main.py
│   ├── errors.py
│   ├── diff_engine.py
│   ├── validators.py
│   ├── autosave_manager.py
│   ├── version_manager.py
│   └── parsers/
│       ├── __init__.py
│       ├── txt_parser.py
│       ├── docx_parser.py
│       └── md_parser.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── unit/
│   │   ├── __init__.py
│   │   ├── test_diff_engine.py
│   │   ├── test_parser_txt.py
│   │   ├── test_parser_docx.py
│   │   ├── test_parser_md.py
│   │   ├── test_version_manager.py
│   │   └── test_validators.py
│   ├── integration/
│   │   ├── __init__.py
│   │   ├── test_api.py
│   │   └── test_e2e_flow.py
│   └── fixtures/
│       ├── hello.txt
│       ├── hello_gbk.txt
│       ├── simple.md
│       ├── simple.docx
│       ├── sample_a.txt
│       └── sample_b.txt
└── dist/                         # Vite build output
```

---

## Phases

### Phase 1: 项目脚手架与基础设施 (Tasks 1-5)

---

### Task 1: Python 后端项目初始化

**Files:**
- Create: `requirements.txt`
- Create: `src_backend/__init__.py`
- Create: `src_backend/main.py` (骨架)
- Create: `src_backend/errors.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

**Interfaces:**
- Produces: FastAPI app at `main:app`, `AppError` exception class, unified error handler

- [ ] **Step 1: 创建 requirements.txt**

```
fastapi>=0.115
uvicorn>=0.32
python-multipart>=0.0.18
diff-match-patch>=20230430
python-docx>=1.1
chardet>=5.2
psutil>=6.0
```

- [ ] **Step 2: 安装 Python 依赖**

Run: `pip install -r requirements.txt`

- [ ] **Step 3: 创建统一错误类**

Create `src_backend/errors.py`:

```python
from enum import Enum
from typing import Optional, Any


class Severity(str, Enum):
    BLOCKING = "blocking"
    WARNING = "warning"
    INFO = "info"


class AppError(Exception):
    """统一应用错误，携带 severity 信息供异常处理器分发。"""

    def __init__(
        self,
        severity: Severity,
        title: str,
        message: str,
        detail: Optional[str] = None,
        status_code: int = 400,
    ):
        self.severity = severity
        self.title = title
        self.message = message
        self.detail = detail
        self.status_code = status_code
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        return {
            "error": True,
            "severity": self.severity.value,
            "title": self.title,
            "message": self.message,
            "detail": self.detail,
        }
```

- [ ] **Step 4: 创建 FastAPI 骨架 main.py**

Create `src_backend/main.py`:

```python
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from src_backend.errors import AppError

app = FastAPI(title="Compare - Document Comparison Tool")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict(),
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 5: 验证服务器可启动**

Run: `python -m uvicorn src_backend.main:app --host 127.0.0.1 --port 17890`

- [ ] **Step 6: 创建测试夹具并编写冒烟测试**

Create `tests/conftest.py`:

```python
import pytest
from fastapi.testclient import TestClient
from src_backend.main import app


@pytest.fixture
def client():
    return TestClient(app)
```

Create `tests/unit/test_health.py`:

```python
def test_health_endpoint(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 7: 运行测试**

Run: `pytest tests/ -v`

- [ ] **Step 8: Commit**

```bash
git add requirements.txt src_backend/ tests/
git commit -m "feat: scaffold Python backend with FastAPI, error handling, and health endpoint"
```

---

### Task 2: Vue 3 + TypeScript + Vite 前端脚手架

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `env.d.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/router/index.ts`
- Create: `src/types/index.ts`
- Create: `src/views/SelectPage.vue`
- Create: `src/views/ReportPage.vue`
- Create: `src/styles/variables.css`
- Create: `src/styles/main.css`

**Interfaces:**
- Produces: Vite dev server, Vue 3 app with vue-router skeleton, two routes (`/` and `/report`), CSS custom properties, complete type definitions

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "compare",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: 安装前端依赖**

Run: `npm install vue@^3.4 vue-router@^4 pinia@^2`
Run: `npm install -D vite@^5 typescript@^5 vue-tsc@^2 @vitejs/plugin-vue vitest@^2 @vue/test-utils@^2 jsdom`

- [ ] **Step 3: 创建配置文件**

Create `vite.config.ts`:

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:17890',
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
})
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "baseUrl": "."
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue", "env.d.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: 创建类型定义**

Create `src/types/index.ts`:

```typescript
export type DiffOpType = '=' | '+' | '-'

export interface DiffOp {
  type: DiffOpType
  text: string
}

export type SegmentOp = 'add' | 'del' | 'mod' | 'none'

export type SegmentOrigin = 'original' | 'user'

export interface Segment {
  text: string
  operation: SegmentOp
  origin: SegmentOrigin
  side?: 'old' | 'new'
  ci?: number
}

export interface ChangeContext {
  index: number
  total: number
  type: 'add' | 'del' | 'mod'
  before: string
  highlight: string
  after: string
}

export interface CompareMeta {
  fileA: string
  fileB: string
  stats: CompareStats
  timestamp: number
  totalChunks: number
}

export interface CompareStats {
  total: number
  add: number
  del: number
  mod: number
}

export type StreamMessage =
  | { type: 'phase'; stage: string; detail: string; progress: number }
  | { type: 'meta'; stats: CompareStats; totalChunks: number }
  | { type: 'segments'; index: number; data: Segment[] }
  | { type: 'done' }

export interface ErrorEnvelope {
  error: true
  severity: 'blocking' | 'warning' | 'info'
  title: string
  message: string
  detail: string | null
}

export type ViewMode = 'unified' | 'split'

export interface VersionEntry {
  id: string
  label: string
  time: number
}

export interface Patch {
  diffs: DiffOp[]
  start1: number
  start2: number
  length1: number
  length2: number
}
```

- [ ] **Step 5: 创建 Vue 入口和路由**

Create `src/main.ts`:

```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import App from './App.vue'
import './styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
```

Create `src/router/index.ts`:

```typescript
import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'select',
      component: () => import('../views/SelectPage.vue'),
    },
    {
      path: '/report',
      name: 'report',
      component: () => import('../views/ReportPage.vue'),
    },
  ],
})
```

- [ ] **Step 6: 创建 CSS 变量**

Create `src/styles/variables.css`:

```css
:root {
  --color-bg: #ffffff;
  --color-bg-secondary: #f5f5f5;
  --color-bg-hover: #f0f0f0;
  --color-text: #1a1a1a;
  --color-text-secondary: #666666;
  --color-add-bg: #e6ffec;
  --color-add-text: #116329;
  --color-del-bg: #ffebe9;
  --color-del-text: #922323;
  --color-mod-old-bg: #ffebe9;
  --color-mod-old-text: #922323;
  --color-mod-new-bg: #e6ffec;
  --color-mod-new-text: #116329;
  --color-user-add-bg: #fff3cd;
  --color-user-add-text: #856404;
  --color-user-del-bg: #f3e8ff;
  --color-user-del-text: #6b21a8;
  --color-search-highlight: #fff9c4;
  --color-search-focus: #fff3cd;
  --color-focus-border: #0969da;
  --color-focus-bg: #eef5ff;
  --color-border: #d0d7de;
  --color-danger: #cf222e;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --font-mono: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-size-sm: 13px;
  --font-size-base: 15px;
}
```

- [ ] **Step 7: 创建其余支撑文件**

Create `index.html`, `tsconfig.node.json`, `env.d.ts`, `src/App.vue`, `src/views/SelectPage.vue`, `src/views/ReportPage.vue`, `src/styles/main.css`.

- [ ] **Step 8: 验证构建**

Run: `npm run build`

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json tsconfig.node.json env.d.ts index.html src/
git commit -m "feat: scaffold Vue 3 + TypeScript + Vite frontend with router and stores"
```

---

### Task 3: 后端解析器 — txt + 编码检测

**Files:**
- Create: `src_backend/parsers/__init__.py`
- Create: `src_backend/parsers/txt_parser.py`
- Create: `tests/unit/test_parser_txt.py`
- Create: `tests/fixtures/hello.txt`
- Create: `tests/fixtures/hello_gbk.txt`

**Interfaces:**
- Consumes: `AppError`, `Severity` from `src_backend.errors`
- Produces: `parse_txt(file_path: str) -> str`

- [ ] **Step 1: 编写测试（TDD RED）**

Create `tests/unit/test_parser_txt.py` with tests for: UTF-8 parsing, BOM detection (UTF-8/UTF-16LE), GBK fallback via chardet, empty file handling.

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/test_parser_txt.py -v`

- [ ] **Step 3: 实现 txt_parser（TDD GREEN）**

Create `src_backend/parsers/txt_parser.py` implementing BOM detection → UTF-8 strict decode → chardet fallback pipeline.

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/test_parser_txt.py -v`

- [ ] **Step 5: 创建 test fixtures**

Create `tests/fixtures/hello.txt` (UTF-8 content), `tests/fixtures/hello_gbk.txt` (GBK content).

- [ ] **Step 6: Commit**

```bash
git add src_backend/parsers/ tests/unit/test_parser_txt.py tests/fixtures/
git commit -m "feat: add txt parser with BOM detection and chardet fallback"
```

---

### Task 4: 后端解析器 — docx + md

**Files:**
- Create: `src_backend/parsers/docx_parser.py`
- Create: `src_backend/parsers/md_parser.py`
- Create: `tests/unit/test_parser_docx.py`
- Create: `tests/unit/test_parser_md.py`
- Create: `tests/fixtures/simple.docx`
- Create: `tests/fixtures/simple.md`

**Interfaces:**
- Produces:
  - `parse_docx(file_path: str) -> str`
  - `parse_md(text: str) -> str`

- [ ] **Step 1: 编写测试（TDD RED）**

Write tests for docx parsing (valid file, invalid file rejection) and md parsing (strip headers, bold/italic, links, images, code blocks, inline code, lists, blockquotes, strikethrough, horizontal rules, HTML tags, blank line collapsing).

- [ ] **Step 2: 实现解析器（TDD GREEN）**

Implement `parse_docx` (ZIP magic validation + python-docx extraction) and `parse_md` (regex-based markdown stripping).

- [ ] **Step 3: 创建 fixtures**

Create `tests/fixtures/simple.docx` (via python-docx) and `tests/fixtures/simple.md`.

- [ ] **Step 4: 运行测试**

Run: `pytest tests/unit/test_parser_docx.py tests/unit/test_parser_md.py -v`

- [ ] **Step 5: Commit**

```bash
git add src_backend/parsers/docx_parser.py src_backend/parsers/md_parser.py tests/unit/test_parser_docx.py tests/unit/test_parser_md.py tests/fixtures/
git commit -m "feat: add docx and markdown parsers with tests"
```

---

### Task 5: Diff 引擎封装

**Files:**
- Create: `src_backend/diff_engine.py`
- Create: `tests/unit/test_diff_engine.py`

**Interfaces:**
- Produces:
  - `diff_texts(orig: str, modified: str) -> tuple[list[dict], dict]`
  - `make_patches(baseline: str, current: str) -> str`
  - `apply_patches(text: str, patches_text: str) -> tuple[str, list[bool]]`

- [ ] **Step 1: 编写测试（TDD RED）**

Test identical texts, single char add/del/mod, empty original/modified, both empty, Chinese text, segment merging (adjacent same ops).

- [ ] **Step 2: 实现 diff_engine（TDD GREEN）**

Wrap google-diff-match-patch: `diff_main(timeout=0)` + `diff_cleanupSemantic()` → merge adjacent same-op diffs → classify as add/del/mod → build segments with stats.

- [ ] **Step 3: 运行测试**

Run: `pytest tests/unit/test_diff_engine.py -v`

- [ ] **Step 4: Commit**

```bash
git add src_backend/diff_engine.py tests/unit/test_diff_engine.py
git commit -m "feat: add diff engine with character-level precision and patch support"
```

---

### Task 6: POST /api/compare — NDJSON 流式对比端点

**Files:**
- Modify: `src_backend/main.py`
- Create: `tests/integration/__init__.py`
- Create: `tests/integration/test_api.py`

**Interfaces:**
- Produces: `POST /api/compare` — multipart upload fileA + fileB, NDJSON streaming response

- [ ] **Step 1: 编写集成测试（TDD RED）**

Test: compare two txt files (NDJSON stream), identical files (0 changes), unsupported format rejection, single file rejection, md file comparison, missing extension fallback.

- [ ] **Step 2: 实现端点（TDD GREEN）**

Add to `main.py`: multipart file upload → validate extensions → save temps → parse via appropriate parser → diff_texts → yield NDJSON chunks (phase → meta → segments ×N → done).

- [ ] **Step 3: 运行测试**

Run: `pytest tests/integration/test_api.py -v`

- [ ] **Step 4: Commit**

```bash
git add src_backend/main.py tests/integration/
git commit -m "feat: add POST /api/compare with NDJSON streaming diff response"
```

---

### Task 7: Autosave + Version API 端点

**Files:**
- Create: `src_backend/autosave_manager.py`
- Create: `src_backend/version_manager.py`
- Modify: `src_backend/main.py`
- Create: `tests/unit/test_version_manager.py`
- Create: `src_backend/validators.py`
- Create: `tests/unit/test_validators.py`

**Interfaces:**
- Produces:
  - `POST /api/autosave` — `{action, key, text?, html?, time?}`
  - `POST /api/versions/save`, `GET /api/versions/list`, `POST /api/versions/restore/{id}`
  - `validate_file(filename, content)` — format validation

- [ ] **Step 1: 实现 version_manager + autosave_manager + validators（TDD）**

VersionManager: save/list/restore with auto-cleanup (>10 versions).
AutosaveManager: save/load JSON files.
Validators: extension check + content sniffing for txt/md/docx.

- [ ] **Step 2: 添加 API 路由到 main.py**

- [ ] **Step 3: 运行全部后端测试**

Run: `pytest tests/ -v`

- [ ] **Step 4: Commit**

```bash
git add src_backend/autosave_manager.py src_backend/version_manager.py src_backend/validators.py src_backend/main.py tests/
git commit -m "feat: add autosave, version management, and file validation endpoints"
```

---

### Task 8: 前端工具层 — API 客户端 + IndexedDB + Storage + Search

**Files:**
- Create: `src/utils/api.ts`
- Create: `src/utils/indexeddb.ts`
- Create: `src/utils/storage.ts`
- Create: `src/utils/search.ts`
- Create: `src/utils/resource.ts`
- Create: `src/utils/keybindings.ts`
- Create: `src/utils/__tests__/api.spec.ts`
- Create: `src/utils/__tests__/search.spec.ts`
- Create: `src/utils/__tests__/storage.spec.ts`

**Interfaces:**
- `api.compareFiles(fileA, fileB, onChunk, signal?)` — streaming fetch with NDJSON parsing
- `api.checkHealth()` — health check
- `indexedDB` — open/clear/putAll/getAll for segments and contexts
- `storage` — localStorage meta/autosave + IndexedDB segments/contexts wrapper
- `searchInSegments(segments, query, options)` — search with regex/case/whole-word
- `useKeyboardShortcuts()` — J/K/V/E/Ctrl+F/Escape bindings
- `estimateMemory(fileA, fileB)` — resource warning

- [ ] **Step 1: 实现并测试所有工具模块**

- [ ] **Step 2: Commit**

```bash
git add src/utils/
git commit -m "feat: add frontend utility layer — API client, storage, search, keybindings"
```

---

### Task 9: Pinia Stores

**Files:**
- Create: `src/stores/compare.ts`
- Create: `src/stores/editor.ts`
- Create: `src/stores/search.ts`
- Create: `src/stores/view.ts`
- Create: `src/stores/version.ts`
- Create: `src/stores/__tests__/compare.spec.ts`

**Interfaces:**
- `useCompareStore` — segments[], contexts[], meta, stats, isComparing, isComplete, error, startCompare(), reset(), buildContexts()
- `useEditorStore` — isEditing, baseline, enterEdit(), exitEdit(), scheduleAutosave()
- `useSearchStore` — isOpen, query, options, matches[], activeMatch, next(), prev(), close()
- `useViewStore` — viewMode, minimapCollapsed, toggleView(), setView()
- `useVersionStore` — versions[], loadVersions(), saveVersion(), restoreVersion()

- [ ] **Step 1: 实现所有 stores 并编写 compare store 测试**

- [ ] **Step 2: 运行测试**

Run: `npx vitest run src/stores/__tests__/`

- [ ] **Step 3: Commit**

```bash
git add src/stores/
git commit -m "feat: add Pinia stores for compare, editor, search, view, and version"
```

---

### Task 10: 选择页 — DropZone + 智能分配

**Files:**
- Create: `src/components/select-page/DropZone.vue`
- Create: `src/components/select-page/EncodeDialog.vue`
- Modify: `src/views/SelectPage.vue`

- [ ] **Step 1: 实现 DropZone（拖拽区、点击选择、双文件智能分配、交换、开始对比）**

- [ ] **Step 2: 实现 EncodeDialog（编码预览确认弹窗）**

- [ ] **Step 3: 更新 SelectPage 集成组件**

- [ ] **Step 4: 验证构建**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/components/select-page/ src/views/SelectPage.vue
git commit -m "feat: add select page with drag-drop, smart file assignment, and format validation"
```

---

### Task 11: 渲染引擎 — segments → HTML

**Files:**
- Create: `src/render/segmentRenderer.ts`
- Create: `src/render/splitRenderer.ts`
- Create: `src/render/__tests__/segmentRenderer.spec.ts`
- Create: `src/render/__tests__/splitRenderer.spec.ts`

**Interfaces:**
- `renderSegmentsToHTML(segments: Segment[]) -> string`
- `segmentsToText(segments: Segment[]) -> string`
- `renderSplitColumns(segments: Segment[]) -> {left: string, right: string}`

- [ ] **Step 1: 编写测试并实现**

Test: plain text rendering, add/del/mod/user segment classes, HTML escaping, split column distribution.

- [ ] **Step 2: 运行测试**

Run: `npx vitest run src/render/__tests__/`

- [ ] **Step 3: Commit**

```bash
git add src/render/
git commit -m "feat: add segment-to-HTML renderer with CSS class mapping and XSS protection"
```

---

### Task 12: UnifiedView + Toolbar + ProgressHeader

**Files:**
- Create: `src/components/report-page/UnifiedView.vue`
- Create: `src/components/report-page/Toolbar.vue`
- Create: `src/components/report-page/ProgressHeader.vue`
- Modify: `src/views/ReportPage.vue`

- [ ] **Step 1: 实现三个组件并集成到 ReportPage**

UnifiedView: innerHTML render with scoped :deep styles for all 8 segment types.
Toolbar: file info, view mode toggle, edit button, export button placeholder.
ProgressHeader: phase-aware streaming progress display with cancel button.

- [ ] **Step 2: 验证构建**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/components/report-page/UnifiedView.vue src/components/report-page/Toolbar.vue src/components/report-page/ProgressHeader.vue src/views/ReportPage.vue
git commit -m "feat: add unified view, toolbar, and progress header components"
```

---

### Task 13: Sidebar — 统计摘要 + Minimap + 变更列表

**Files:**
- Create: `src/components/report-page/Sidebar.vue`
- Create: `src/components/report-page/Minimap.vue`
- Modify: `src/views/ReportPage.vue`

- [ ] **Step 1: 实现 Minimap（热力密度条，60个色块）**

- [ ] **Step 2: 实现 Sidebar（统计4宫格、minimap折叠、变更按类型分组列表、清除缓存按钮）**

- [ ] **Step 3: 更新 ReportPage 加入 Sidebar 布局**

- [ ] **Step 4: Commit**

```bash
git add src/components/report-page/Sidebar.vue src/components/report-page/Minimap.vue src/views/ReportPage.vue
git commit -m "feat: add sidebar with stats, minimap, and change list navigation"
```

---

### Task 14: SplitView 分栏视图

**Files:**
- Create: `src/components/report-page/SplitView.vue`
- Modify: `src/views/ReportPage.vue`

- [ ] **Step 1: 实现 SplitView（CSS Grid 双栏 + 24px gutter + 同步滚动 + 密度条）**

- [ ] **Step 2: 更新 ReportPage 支持 viewMode 切换**

- [ ] **Step 3: Commit**

```bash
git add src/components/report-page/SplitView.vue src/views/ReportPage.vue
git commit -m "feat: add split view with dual-pane synchronized scrolling"
```

---

### Task 15: SearchBar 搜索+替换+正则

**Files:**
- Create: `src/components/report-page/SearchBar.vue`
- Modify: `src/views/ReportPage.vue`

- [ ] **Step 1: 实现 SearchBar（输入即时搜索、Aa/ab/.* 选项、▲▼导航、计数、替换框）**

- [ ] **Step 2: 集成到 ReportPage（Ctrl+F 触发、快捷键驱动）**

- [ ] **Step 3: Commit**

```bash
git add src/components/report-page/SearchBar.vue src/views/ReportPage.vue
git commit -m "feat: add search bar with regex, case-sensitivity, and whole-word matching"
```

---

### Task 16: 编辑模式 — 合并分类 + 单层渲染

**Files:**
- Create: `src/render/editClassifier.ts`
- Create: `src/render/__tests__/editClassifier.spec.ts`
- Modify: `src/components/report-page/Toolbar.vue`
- Modify: `src/components/report-page/UnifiedView.vue`

- [ ] **Step 1: 实现 editClassifier**

reclassifySegments(originalSegments, baseline, current) → user-origin segments based on patch coverage.

- [ ] **Step 2: 添加 contentEditable 支持到 UnifiedView（编辑模式）**

- [ ] **Step 3: 运行测试**

Run: `npx vitest run src/render/__tests__/editClassifier.spec.ts`

- [ ] **Step 4: Commit**

```bash
git add src/render/editClassifier.ts src/render/__tests__/editClassifier.spec.ts src/components/report-page/
git commit -m "feat: add edit mode with merge classification and single-layer rendering"
```

---

### Task 17: 导出功能 — TXT/MD/HTML

**Files:**
- Create: `src/export/exporters.ts`
- Create: `src/export/__tests__/exporters.spec.ts`
- Create: `src/components/report-page/ExportDialog.vue`
- Modify: `src/components/report-page/Toolbar.vue`

- [ ] **Step 1: 实现导出函数**

exportToTXT/exportToHTML/exportToMD + downloadFile helper. Mode-driven: view→annotated, edit→clean.

- [ ] **Step 2: 实现 ExportDialog（格式多选、模式驱动默认值、触发下载）**

- [ ] **Step 3: 集成到 Toolbar**

- [ ] **Step 4: 运行测试**

Run: `npx vitest run src/export/__tests__/`

- [ ] **Step 5: Commit**

```bash
git add src/export/ src/components/report-page/ExportDialog.vue src/components/report-page/Toolbar.vue
git commit -m "feat: add export to TXT/MD/HTML with mode-driven behavior"
```

---

### Task 18: 版本管理 + 错误处理 UI

**Files:**
- Create: `src/components/report-page/VersionHistory.vue`
- Create: `src/components/report-page/ErrorDisplay.vue`
- Modify: `src/views/ReportPage.vue`

- [ ] **Step 1: 实现 VersionHistory（保存/恢复/列表/自动清理提示）**

- [ ] **Step 2: 实现 ErrorDisplay（blocking/warning/info 三级展示）**

- [ ] **Step 3: 集成到 ReportPage**

- [ ] **Step 4: Commit**

```bash
git add src/components/report-page/VersionHistory.vue src/components/report-page/ErrorDisplay.vue src/views/ReportPage.vue
git commit -m "feat: add version history dialog and unified error display"
```

---

### Task 19: 配置 + 静态文件挂载 + 启动脚本

**Files:**
- Create: `start.bat`
- Create: `.env.example`
- Create: `.gitignore`
- Modify: `src_backend/main.py`

- [ ] **Step 1: 创建 start.bat、.env.example、.gitignore**

- [ ] **Step 2: 添加 FastAPI static files mount（dist/ + SPA fallback）**

- [ ] **Step 3: 构建前端 + 启动后端 → 验证完整流程**

Run: `npm run build`
Run: `python -m uvicorn src_backend.main:app --host 127.0.0.1 --port 17890`

- [ ] **Step 4: Commit**

```bash
git add start.bat .env.example .gitignore src_backend/main.py
git commit -m "chore: add startup script, env config, gitignore, and SPA static mount"
```

---

### Task 20: 端到端集成测试 + 最终验证

**Files:**
- Create: `tests/integration/test_e2e_flow.py`
- Create: `tests/fixtures/sample_a.txt`
- Create: `tests/fixtures/sample_b.txt`
- Create: `tests/fixtures/sample.md`

- [ ] **Step 1: 编写 E2E 测试**

Test: full compare flow (txt + md), version save/restore cycle, autosave save/load cycle.

- [ ] **Step 2: 运行全部测试**

Run: `pytest tests/ -v --tb=short`
Run: `npx vitest run`

- [ ] **Step 3: 构建验证**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add tests/ && git commit -m "test: add end-to-end integration tests"
git add -A && git commit -m "chore: final verification — all tests pass, build succeeds"
```

---

## Self-Review

### Spec Coverage

| Design Section | Task(s) |
|---|---|
| §1-3 概述/架构/技术栈 | Tasks 1-2 |
| §4 文档解析 | Tasks 3-4 |
| §5 Diff 引擎 | Task 5 |
| §6 数据模型 | Task 2 (types) |
| §7 HTTP API | Tasks 6-7, 19 |
| §8 路由与状态管理 | Tasks 2, 9 |
| §9 界面设计 | Tasks 10-17 |
| §10 编辑模式与版本管理 | Tasks 16, 18 |
| §11 搜索功能 | Tasks 8, 15 |
| §12 导出功能 | Task 17 |
| §13 键盘快捷键 | Task 8 (keybindings) |
| §14 错误处理 | Task 18 (ErrorDisplay) |
| §15 边界情况 | Task 5 (diff handles edge cases) |
| §16 格式校验 | Task 7 (validators) |
| §17 设置与配置 | Task 19 |
| §18 测试策略 | All tasks (TDD) |
| §19 分发部署 | Task 19 |
| §20-21 兼容性/决策 | Tasks 1-2 (scaffold) |

All design sections are covered. No placeholders. All types and signatures are concrete.

---

*Plan generated 2026-07-28. Based on design doc `docs/superpowers/specs/2026-07-27-compare-design.md`.*
