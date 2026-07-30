import json
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src_backend.autosave_manager import AutosaveManager
from src_backend.diff_engine import diff_texts
from src_backend.errors import AppError, Severity
from src_backend.parsers import parse_docx, parse_md, parse_txt
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

VALID_EXTENSIONS = frozenset({".txt", ".docx", ".md"})
CHUNK_SIZE = 50


# ── Request schemas ───────────────────────────────────────────────

class AutosaveRequest(BaseModel):
    action: str
    key: str
    text: str = ""
    html: str = ""
    time: float = 0.0


class VersionSaveRequest(BaseModel):
    label: str
    file_a_content: str
    file_b_content: str
    stats: dict


# ── Helpers ───────────────────────────────────────────────────────

def _get_ext(filename: str | None) -> str:
    """Extract lowercase file extension; returns '' when missing."""
    if not filename:
        return ""
    return Path(filename).suffix.lower()


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
            f"不支持 {ext} 格式（文件 \"{filename}\"），仅支持 .txt, .docx, .md。",
            status_code=400,
        )
    return ext


def _parse_file(path: str, ext: str) -> str:
    """Dispatch to the correct parser based on file extension."""
    if ext == ".txt":
        return parse_txt(path)
    if ext == ".docx":
        return parse_docx(path)
    if ext == ".md":
        with open(path, "r", encoding="utf-8") as fh:
            return parse_md(fh.read())
    raise AppError(
        Severity.BLOCKING,
        "不支持的文件格式",
        f"不支持 {ext} 格式。",
        status_code=400,
    )


def _build_ndjson(segments: list[dict], stats: dict):
    """Yield NDJSON lines for the streaming compare response."""
    yield json.dumps({
        "type": "phase",
        "stage": "parsing",
        "detail": "Analyzing files...",
        "progress": 10,
    }, ensure_ascii=False) + "\n"

    yield json.dumps({
        "type": "phase",
        "stage": "diffing",
        "detail": "Computing differences...",
        "progress": 50,
    }, ensure_ascii=False) + "\n"

    total = (len(segments) + CHUNK_SIZE - 1) // CHUNK_SIZE if segments else 0
    yield json.dumps({
        "type": "meta",
        "stats": stats,
        "totalChunks": total,
    }) + "\n"

    for i in range(0, len(segments), CHUNK_SIZE):
        idx = i // CHUNK_SIZE
        yield json.dumps({
            "type": "segments",
            "index": idx,
            "data": segments[i:i + CHUNK_SIZE],
        }, ensure_ascii=False) + "\n"

    yield json.dumps({"type": "done"}) + "\n"


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
async def compare(
    fileA: UploadFile = File(...),
    fileB: UploadFile = File(...),
):
    """Compare two documents and return character-level diff as NDJSON stream."""
    ext_a = _validate_upload(fileA)
    ext_b = _validate_upload(fileB)

    tmp_a = tempfile.NamedTemporaryFile(suffix=ext_a, delete=False)
    tmp_b = tempfile.NamedTemporaryFile(suffix=ext_b, delete=False)

    try:
        tmp_a.write(await fileA.read())
        tmp_b.write(await fileB.read())
        tmp_a.flush()
        tmp_b.flush()

        text_a = _parse_file(tmp_a.name, ext_a)
        text_b = _parse_file(tmp_b.name, ext_b)
    finally:
        tmp_a.close()
        tmp_b.close()
        for p in (tmp_a.name, tmp_b.name):
            try:
                os.unlink(p)
            except OSError:
                pass

    segments, stats = diff_texts(text_a, text_b)
    return StreamingResponse(
        _build_ndjson(segments, stats),
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
        am.save(req.key, text=req.text, html=req.html, timestamp=req.time)
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
    vid = vm.save(req.label, req.file_a_content, req.file_b_content, req.stats)
    return {"status": "ok", "id": vid}


@app.get("/api/versions/list")
async def version_list():
    """List all saved versions, newest first."""
    vm = VersionManager(storage_dir=_get_versions_dir())
    return {"status": "ok", "versions": vm.list()}


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
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="static")
else:
    # Dev mode fallback: redirect root to Vite dev server
    @app.get("/")
    async def root():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="http://localhost:5173")
