"""File format validation for uploaded documents."""

from pathlib import Path

VALID_EXTENSIONS = frozenset({".txt", ".docx", ".md", ".idml"})
MD_MIN_LENGTH = 3


def _get_ext(filename: str) -> str:
    """Extract lowercase file extension; returns '' when missing."""
    return Path(filename).suffix.lower()


def validate_file(filename: str, content: str) -> dict:
    """Validate file format and content.

    Returns dict with keys: valid (bool), format (str), errors (list[str]).
    """
    errors: list[str] = []
    ext = _get_ext(filename)

    if not ext:
        return {
            "valid": False,
            "format": "unknown",
            "errors": ["文件缺少扩展名，无法确定文件类型。"],
        }

    if ext not in VALID_EXTENSIONS:
        return {
            "valid": False,
            "format": ext.lstrip("."),
            "errors": [f"不支持 {ext} 格式，仅支持 .txt, .docx, .md, .idml。"],
        }

    fmt = ext.lstrip(".")

    if not content.strip():
        errors.append("文件内容为空，请提供包含文本的文件。")

    # MD minimum content check
    if ext == ".md" and content.strip() and len(content.strip()) < MD_MIN_LENGTH:
        errors.append(
            f"Markdown 文件内容过短（最少需要 {MD_MIN_LENGTH} 个字符）。"
        )

    return {
        "valid": len(errors) == 0,
        "format": fmt,
        "errors": errors,
    }
