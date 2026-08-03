import chardet
from src_backend.errors import AppError, Severity

# Windows/macOS legacy line endings → LF. CodeMirror 6 drops '\r' from its
# document model (DefaultSplit = /\r\n?|\n/), so any '\r' surviving into
# the diff baseline would be misclassified as phantom deletions once the
# user edits. Normalize at parse time so baselines are always CR-free.
def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _detect_bom(data: bytes) -> str | None:
    """检测 BOM 并返回对应编码，无 BOM 返回 None。"""
    if data[:3] == b"\xef\xbb\xbf":
        return "utf-8-sig"
    if data[:2] == b"\xff\xfe":
        return "utf-16-le"
    if data[:2] == b"\xfe\xff":
        return "utf-16-be"
    return None


def parse_txt(file_path: str) -> str:
    """读取 txt 文件，自动检测编码，返回纯文本内容。"""
    with open(file_path, "rb") as f:
        raw = f.read()

    if len(raw) == 0:
        return ""

    # 1. BOM 检测
    bom_encoding = _detect_bom(raw)
    if bom_encoding:
        return normalize_newlines(raw.decode(bom_encoding).lstrip("\ufeff"))

    # 2. UTF-8 严格解码
    try:
        return normalize_newlines(raw.decode("utf-8"))
    except UnicodeDecodeError:
        pass

    # 3. chardet 自动检测
    result = chardet.detect(raw)
    encoding = result.get("encoding") if result else None

    if not encoding:
        raise AppError(
            Severity.BLOCKING,
            "编码检测失败",
            "无法确定文件编码，请确认文件格式。",
            status_code=400,
        )

    try:
        return normalize_newlines(raw.decode(encoding))
    except (UnicodeDecodeError, LookupError):
        raise AppError(
            Severity.BLOCKING,
            "文件解码失败",
            f"尝试使用 {encoding} 解码失败，文件可能已损坏。",
            status_code=400,
        )
