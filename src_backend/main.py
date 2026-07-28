import json
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from src_backend.diff_engine import diff_texts
from src_backend.errors import AppError, Severity
from src_backend.parsers import parse_docx, parse_md, parse_txt

app = FastAPI(title="Compare - Document Comparison Tool")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_EXTENSIONS = frozenset({".txt", ".docx", ".md"})
CHUNK_SIZE = 50


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
