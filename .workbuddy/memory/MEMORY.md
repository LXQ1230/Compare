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

## 实施计划
- 详见 `docs/编辑模式实现计划.md`
- 三期实施：第一期 19 项核心闭环 / 第二期 11 项 UX+保存 / 第三期 45 项边缘+测试+性能
- 5 批盲点共 75 项（P0:13 / P1:37 / P2:25）

## 用户偏好
- 偏好：简洁、不废话、有问题直接指出来
- 决策风格：先讨论后编程，多轮深挖确认细节
- 不喜欢立即编程，需要先看到完整方案
