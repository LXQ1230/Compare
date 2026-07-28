import os
from src_backend.errors import AppError, Severity

ZIP_MAGIC = b"PK\x03\x04"


def parse_docx(file_path: str) -> str:
    """从 docx 文件提取纯文本，跳过图片/表格/页眉页脚/批注。"""
    with open(file_path, "rb") as f:
        header = f.read(4)

    if header[:4] != ZIP_MAGIC:
        raise AppError(
            Severity.BLOCKING,
            "文件格式无效",
            f"{os.path.basename(file_path)} 不是有效的 docx 文件（缺少 ZIP 文件头）。",
            detail=f"Expected PK\x03\x04 at offset 0, got {header[:4].hex()}",
            status_code=400,
        )

    try:
        from docx import Document
        doc = Document(file_path)
    except Exception as e:
        raise AppError(
            Severity.BLOCKING,
            "docx 文件无法打开",
            f"无法解析 {os.path.basename(file_path)}，该文件可能已损坏。",
            detail=str(e),
            status_code=400,
        )

    paragraphs: list[str] = []
    for para in doc.paragraphs:
        text = para.text
        if text:
            paragraphs.append(text)

    return "\n".join(paragraphs)
