import json
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from src_backend.autosave_manager import AutosaveManager
from src_backend.diff_engine import diff_texts, diff_texts_with_style
from src_backend.errors import AppError, Severity
from src_backend.parsers import parse_docx, parse_idml, parse_md, parse_txt
from src_backend.validators import _get_ext
from src_backend.version_manager import VersionManager

app = FastAPI(title="Compare - Document Comparison Tool")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_EXTENSIONS = frozenset({".txt", ".docx", ".md", ".idml"})
# ~500 万汉字（UTF-8 约 3 字节/字）——超大文件上限，超限直接阻止（方案 L0/XL）
COMPARE_MAX_BYTES = int(os.environ.get("COMPARE_MAX_BYTES", "15000000"))


def _classify_scale(chars: int) -> str:
    """按真实字符数分级（方案 L0）：S/M/L/XL。"""
    if chars <= 100_000:
        return "S"
    if chars <= 500_000:
        return "M"
    if chars <= 5_000_000:
        return "L"
    return "XL"


# ── Request schemas ───────────────────────────────────────────────

class AutosaveRequest(BaseModel):
    action: str
    key: str
    text: str = ""
    html: str = ""
    time: float = 0.0
    cursor_pos: int = 0
    scroll_pos: int = 0
    last_edit_offset: int = -1
    processed_cis: list = []
    file_a_name: str = ""
    file_b_name: str = ""
    stats: dict = {}
    total_chunks: int = 0
    baseline_style: list = []


class VersionSaveRequest(BaseModel):
    label: str
    file_a_content: str
    file_b_content: str
    stats: dict
    style_a: list = []
    style_b: list = []
    doc_meta: dict = {}
    session_key: str = ""


# ── Helpers ───────────────────────────────────────────────────────

def _read_limited(upload: UploadFile, sink, max_bytes: int) -> int:
    """分块读取上传，超限立即中断并抛 413（方案 P1-2，防内存 DoS）。

    替代原先的全量 read + tell() 检查——超限文件不再被整体读入内存。
    同步版：/api/compare 为同步端点（丢线程池，防阻塞事件循环）。
    """
    total = 0
    while True:
        chunk = upload.file.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise AppError(
                Severity.BLOCKING,
                "文件过大",
                f"文件超过 {max_bytes // 1_000_000}MB（约 500 万字）上限，请拆分后对比。",
                status_code=413,
            )
        sink.write(chunk)
    return total


def _validate_upload(upload: UploadFile) -> str:
    """Validate a single uploaded file has a supported extension.

    Returns the lowercased extension on success.
    """
    filename = upload.filename or ""
    ext = _get_ext(filename)
    if not ext:
        raise AppError(
            Severity.BLOCKING,
            "无法识别文件格式",
            f"文件 \"{filename}\" 缺少扩展名，无法确定文件类型。",
            status_code=400,
        )
    if ext not in VALID_EXTENSIONS:
        raise AppError(
            Severity.BLOCKING,
            "不支持的文件格式",
            f"不支持 {ext} 格式（文件 \"{filename}\"），仅支持 .txt, .docx, .md, .idml。",
            status_code=400,
        )
    return ext


def _parse_file(path: str, ext: str) -> tuple[str, list | None, dict | None]:
    """Dispatch to the correct parser based on file extension.

    Returns (text, spans, doc_meta)：
      - 非 IDML：spans=None, doc_meta=None（style 可选字段，零开销，方案 §4.2）
      - IDML：spans=StyleSpan 序列化列表，doc_meta=排版元数据（竖排/行高/缩进）
    """
    if ext == ".txt":
        return parse_txt(path), None, None
    if ext == ".docx":
        return parse_docx(path), None, None
    if ext == ".md":
        with open(path, "r", encoding="utf-8") as fh:
            return parse_md(fh.read()), None, None
    if ext == ".idml":
        result = parse_idml(path)
        return (
            result.text,
            [sp.to_dict() for sp in result.spans],
            result.meta.to_dict(),
        )
    raise AppError(
        Severity.BLOCKING,
        "不支持的文件格式",
        f"不支持 {ext} 格式。",
        status_code=400,
    )


def _iter_chunk_ranges(segments: list[dict], max_chars: int = 64 * 1024):
    """按字符数切 chunk（每 chunk ≤64KB 文本），返回 (start, end) 索引对。

    替代固定 50 段/块：百万段场景 JSON 解析次数从 2 万降到 ~200（方案 P1）。
    """
    start = 0
    n = 0
    for i, s in enumerate(segments):
        n += len(s.get("text", ""))
        if n >= max_chars:
            yield start, i + 1
            start = i + 1
            n = 0
    if start < len(segments):
        yield start, len(segments)


def _ndjson_line(obj: dict) -> str:
    """序列化一条 NDJSON 行。

    U+2029（段落分隔符）/U+2028（行分隔符）是 IDML 段落边界（方案 §5.7.1），
    但部分按行拆分逻辑（str.splitlines）会将其误判为行边界切断 JSON。
    统一转义为 \\u 序列（json.loads 自动还原），保证 NDJSON 行完整性。
    """
    s = json.dumps(obj, ensure_ascii=False)
    s = s.replace("\u2029", "\\u2029").replace("\u2028", "\\u2028")
    return s + "\n"


def _build_ndjson(segments: list[dict], stats: dict, scale: str, doc_meta: dict | None = None):
    """Yield NDJSON lines for the streaming compare response."""
    yield _ndjson_line({
        "type": "phase",
        "stage": "parsing",
        "detail": "Analyzing files...",
        "progress": 10,
    })

    yield _ndjson_line({
        "type": "phase",
        "stage": "diffing",
        "detail": "Computing differences...",
        "progress": 50,
    })

    ranges = list(_iter_chunk_ranges(segments))
    meta_payload: dict = {
        "type": "meta",
        "stats": stats,
        "totalChunks": len(ranges),
        "scale": scale,
    }
    if doc_meta:
        # IDML 排版元数据（竖排/行高/缩进/字体告警）随 meta 行传输（方案 §5.3）
        meta_payload["docMeta"] = doc_meta
    yield _ndjson_line(meta_payload)

    for idx, (s, e) in enumerate(ranges):
        yield _ndjson_line({
            "type": "segments",
            "index": idx,
            "data": segments[s:e],
        })

    yield _ndjson_line({"type": "done"})


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict(),
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/compare")
def compare(
    fileA: UploadFile = File(...),
    fileB: UploadFile = File(...),
):
    """Compare two documents and return character-level diff as NDJSON stream.

    同步 def（非 async）：diff 是 CPU 密集操作，FastAPI 自动丢线程池执行，
    防止阻塞事件循环导致 health/autosave 等其他端点假死（2026-08-06 修复）。
    """
    ext_a = _validate_upload(fileA)
    ext_b = _validate_upload(fileB)

    tmp_a = tempfile.NamedTemporaryFile(suffix=ext_a, delete=False)
    tmp_b = tempfile.NamedTemporaryFile(suffix=ext_b, delete=False)

    try:
        # 方案 P1-2: 分块读取，超限立即中断（不再全量读入内存后 tell() 检查）
        _read_limited(fileA, tmp_a, COMPARE_MAX_BYTES)
        _read_limited(fileB, tmp_b, COMPARE_MAX_BYTES)
        tmp_a.flush()
        tmp_b.flush()

        text_a, spans_a, meta_a = _parse_file(tmp_a.name, ext_a)
        text_b, spans_b, meta_b = _parse_file(tmp_b.name, ext_b)
    finally:
        tmp_a.close()
        tmp_b.close()
        for p in (tmp_a.name, tmp_b.name):
            try:
                os.unlink(p)
            except OSError:
                pass

    # IDML：diff 时按 A/B 游标附着 StyleSpan（§5.8）；非 IDML 零开销
    if spans_a is not None or spans_b is not None:
        segments, stats = diff_texts_with_style(text_a, text_b, spans_a, spans_b)
    else:
        segments, stats = diff_texts(text_a, text_b)
    scale = _classify_scale(max(len(text_a), len(text_b)))
    doc_meta = meta_a or meta_b
    return StreamingResponse(
        _build_ndjson(segments, stats, scale, doc_meta),
        media_type="application/x-ndjson",
    )


# ── Autosave ──────────────────────────────────────────────────────

def _get_autosave_dir() -> str:
    return os.environ.get("AUTOSAVE_DIR", "./autosaves")


def _get_versions_dir() -> str:
    return os.environ.get("VERSION_DIR", "./versions")


@app.post("/api/autosave")
async def autosave(req: AutosaveRequest):
    """Save, load, or delete an autosave draft."""
    am = AutosaveManager(storage_dir=_get_autosave_dir())
    action = req.action

    if action == "save":
        am.save(
            req.key, text=req.text, html=req.html, timestamp=req.time,
            cursor_pos=req.cursor_pos, scroll_pos=req.scroll_pos,
            last_edit_offset=req.last_edit_offset,
            processed_cis=req.processed_cis,
            file_a_name=req.file_a_name, file_b_name=req.file_b_name,
            stats=req.stats, total_chunks=req.total_chunks,
            baseline_style=req.baseline_style,
        )
        return {"status": "ok"}

    if action == "load":
        data = am.load(req.key)
        return {"status": "ok", "data": data}

    if action == "delete":
        am.delete(req.key)
        return {"status": "ok"}

    raise AppError(
        Severity.BLOCKING,
        "无效操作",
        f"autosave 不支持 action={action}，仅支持 save/load/delete。",
        status_code=400,
    )


# ── Versions ──────────────────────────────────────────────────────

@app.post("/api/versions/save")
async def version_save(req: VersionSaveRequest):
    """Save a named version of the current compare session."""
    vm = VersionManager(storage_dir=_get_versions_dir())
    vid = vm.save(
        req.label, req.file_a_content, req.file_b_content, req.stats,
        style_a=req.style_a, style_b=req.style_b, doc_meta=req.doc_meta,
        session_key=req.session_key,
    )
    return {"status": "ok", "id": vid}


@app.get("/api/versions/list")
async def version_list(session_key: str = ""):
    """List saved versions, newest first. Filter by session_key if provided."""
    vm = VersionManager(storage_dir=_get_versions_dir())
    return {"status": "ok", "versions": vm.list(session_key)}


@app.post("/api/versions/restore/{version_id}")
async def version_restore(version_id: str):
    """Restore a specific version by id."""
    vm = VersionManager(storage_dir=_get_versions_dir())
    entry = vm.restore(version_id)
    if entry is None:
        raise AppError(
            Severity.BLOCKING,
            "版本未找到",
            f"版本 {version_id} 不存在或已被删除。",
            status_code=404,
        )
    return {"status": "ok", "version": entry}


# ── SPA static mount (production mode) ────────────────────────────

DIST_DIR = Path(__file__).resolve().parents[1] / "dist"
if DIST_DIR.is_dir():
    # 方案 P1-1c/P2-1 配套: SPA 硬刷新 fallback。StaticFiles(html=True) 对
    # /report/:sessionId 等前端路由直接请求返回 404（非文件路径），导致
    # 浏览器刷新/直接访问子路由白屏。改为 catch-all：已有静态文件按真实
    # 路径返回，其余一律回退 index.html（前端 history 路由接管）。
    # 路径穿越防护：候选路径必须落在 dist 目录内。
    _DIST_ROOT = DIST_DIR.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        if full_path:
            candidate = (_DIST_ROOT / full_path).resolve()
            if candidate.is_relative_to(_DIST_ROOT) and candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(_DIST_ROOT / "index.html")
else:
    # Dev mode fallback: redirect root to Vite dev server
    @app.get("/")
    async def root():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="http://localhost:5173")
