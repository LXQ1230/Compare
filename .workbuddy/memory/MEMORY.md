# IDML 对比工具 - 项目长期记忆

## 项目定位
- 文档对比工具，当前支持 .txt/.docx/.md（validators.py 限制）
- IDML 流程状态待确认（需求文档说是 IDML 工具但 validators 不验证 IDML）
- 编辑模式核心承诺：三方 Diff 区分原始变更与用户编辑

## 编辑模式核心架构
- 编辑器：CodeMirror 6（不是文档说的 contentEditable）
- 字符级 diff：diff-match-patch JS 版 1.0.5
- 两层 Decoration：diffField（原始差异）+ userField（用户编辑，叠加覆盖）
- 4 色方案：user-add(琥珀)/user-del(紫)/user-mod-old(暖橙删除线)/user-mod-new(暖橙加粗)

## 关键技术约束
- baseline 必须固定为"修改后"文本（过滤 del/mod-old 段拼接）
- CodeMirror 必须装 history() + keymap + IME 扩展才能正常工作
- Widget Decoration 用于显示"被删/被改-旧值"，side: -1 保证视觉顺序
- diff-match-patch JS 版对 surrogate pair 处理错位，需 Array.from 转换

## 标点归因防线（2026-08-05，diff 语义核心）
- 背景：DMP 最小编辑不唯一，"替换实词"与"插入标点"数学等价；佛经句读场景必须优先归因标点，空白符（\n、\u3000、\u2003 等）是排版符号非内容
- **L1 标点移动**（08-04）：DEL X + 纯标点间隔(≤8) + ADD X → ADD 标点 + X + DEL 标点
- **L2 标点包裹**（08-05）：DEL X + ADD Y，X⊂Y → ADD P + EQ X + ADD Q；Y⊂X → DEL P + EQ Y + DEL Q（两侧须纯标点，含汉字=真替换不重写）
- **L3 实词对齐兜底**（08-05）：DEL X + ADD Y 去标点+空白后实词串相同 → 间隙对齐强制标点归因；与前后操作相邻会合成 mod 时放弃重写
- **W 空白归因**（08-05）：DEL 纯空白 + ADD 纯标点 → 折叠为 ADD 标点（空白删除隐藏）；孤立 DEL 纯空白 → 隐藏。_WS_CHARS 含 \n\r\t、U+3000、U+2000-200A、NBSP、BOM
- 调用链 L1→L2→L3→W→merge；前后端同步
- 实现：后端 `src_backend/diff_engine.py`（_resolve_punct_substring/_resolve_punct_alignment/_resolve_whitespace）+ 前端 `src/render/unicode.ts`（resolvePunctSubstring/resolvePunctAlignment/resolveWhitespace）
- 测试：后端 113 + 前端 122 全过；真实文件 mod 2341→44（Word 句读场景）

## 后端基础设施
- POST /api/autosave 已就绪（save/load/delete）
- POST /api/versions/save + GET /api/versions/list + POST /api/versions/restore/{id}
- AutosaveManager 文件存储 ./autosaves/，明文 JSON
- autosave payload 已扩展：cursor_pos/scroll_pos/last_edit_offset/processed_cis/baseline/file_a_name/file_b_name

## 编辑会话持久化（2026-08-04 一期+二期完成）
- 草稿 key：FNV-1a hash(fileAName+fileBName+baseline 文本) — compareStore 无原始内容，baseline 等价识别
- 双写：localStorage（前缀 cmp_edit_，即时，超容量剥离 segments 降级）+ 后端 /api/autosave（异步，完整含 segments/stats）
- 三层定位：光标/滚动恢复 + 📌 末编辑点 bookmark + 侧边栏进度（✓ 徽章 + 已处理 X/Y）
- 三种保存：防抖 2s + exitEdit + Toolbar 💾 按钮
- 恢复入口：首页 SelectPage "未完成的编辑"列表点击恢复（resumeDraft → restoreFromDraft + resumeFromDraft，免重跑对比）；或重传同文件 → 点编辑 → 弹窗
- CodeMirrorDiff：watch isEditing 必须 immediate:true（resume 挂载前已 true）；ensureEditor 用 hasDraft 判断 initialDoc，不可用 baseline 覆盖 editText
- 📌 图标 2 秒自动消失（bookmarkTimer）；"从头开始"二次确认（confirmDiscard）；saveDraft 跳过空草稿（!hasEdits && editText===baseline）；discardDraft 需 resetToken++ 重置编辑器 doc；reset 时 suppressSave 包住全部程序化 dispatch
- 构建坑：vite.config.ts emptyOutDir:false（safe-delete 拦 rmSync）；vitest 需 --no-cache（dev server 锁 .vite 缓存）
- 环境坑：WorkBuddy 沙箱进程无法覆盖已存在文件（autosave 覆盖写 500），用户 start.bat 正常
- UI 端到端已验证（2026-08-04 agent-browser）：上传→编辑→防抖保存→首页草稿→点击恢复全链路通过
- agent-browser 已装：C:\Users\Admin\.workbuddy\binaries\node\workspace\node_modules\.bin\agent-browser（npx 受 npm safe-delete 干扰）

## 全栈审查结论（2026-08-04，报告 docs/审查报告-2026-08-04.md）
- **版本历史功能整体损坏（P1）**：① 无 UI 入口（ReportPage showVersions 永 false）② VersionHistory.vue saveVersion 传空内容 ('','',{}) ③ restoreVersion 返回值不应用。修复时三处一起改
- **P1**：/api/compare 先 read 后查大小（内存 DoS），应分块读计数超限即拒
- **P2 重点**：restoreFromDraft 未 saveMeta → 草稿恢复会话硬刷新被踢回首页；Sidebar.scrollTo 缺 isLargeDoc 分支（大文档查看态跳转失效，ReportPage.scrollToContext 是对的，两处逻辑不一致）；scrollToActiveMatch 编辑态走 DOM ci-N 失效（应加 CM 通道）；segOffsets 编辑前构建不随编辑更新（跳转偏移错位）
- **P2**：resetToOriginal 不清理草稿；compressHistory 后 suppressClassifyNext 标志残留（setState 同 doc 时 docChanged=false 不消费）；protectAstral 超 6400 个非 BMP 字符占位符冲突
- 安全面✅：XSS（esc 完整+动态验证通过）、路径注入（sha256/正则白名单）、CORS、md 剥离 HTML
- 测试：后端 86 + 前端 84 全过；缺口=版本集成/压缩历史/编辑态搜索/大文档侧边栏/硬刷新恢复

## 实施计划
- 详见 `docs/编辑模式实现计划.md`
- 三期实施：第一期 19 项核心闭环 / 第二期 11 项 UX+保存 / 第三期 45 项边缘+测试+性能
- 5 批盲点共 75 项（P0:13 / P1:37 / P2:25）

## 用户偏好
- 偏好：简洁、不废话、有问题直接指出来
- 决策风格：先讨论后编程，多轮深挖确认细节
- 不喜欢立即编程，需要先看到完整方案
