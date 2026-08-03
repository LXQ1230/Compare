import re
from src_backend.parsers.txt_parser import normalize_newlines


def parse_md(text: str) -> str:
    """剥离 Markdown 标记，返回纯文本内容，保留段落结构。"""
    # HTML 标签（先处理）
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)

    # 代码块
    text = re.sub(r"```[\s\S]*?```", lambda m: m.group(0).strip("`"), text)

    # 图片 ![alt](url)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)

    # 链接 [text](url)
    text = re.sub(r"\[([^\]]*)\]\([^)]+\)", r"\1", text)

    # 标题
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)

    # 粗体
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)

    # 斜体
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", text)
    text = re.sub(r"(?<!_)_([^_]+)_(?!_)", r"\1", text)

    # 删除线
    text = re.sub(r"~~([^~]+)~~", r"\1", text)

    # 行内代码
    text = re.sub(r"`([^`]+)`", r"\1", text)

    # 水平分隔线
    text = re.sub(r"^[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)

    # 引用
    text = re.sub(r"^>\s?", "", text, flags=re.MULTILINE)

    # 无序列表
    text = re.sub(r"^[\s]*[-*+]\s+", "", text, flags=re.MULTILINE)

    # 有序列表
    text = re.sub(r"^[\s]*\d+\.\s+", "", text, flags=re.MULTILINE)

    # 表格分隔行
    text = re.sub(r"^\|?[\s]*[-:| ]{3,}[\s]*\|?\s*$", "", text, flags=re.MULTILINE)

    # 表格竖线
    text = re.sub(r"\|", " ", text)

    # 合并连续空行
    text = re.sub(r"\n{3,}", "\n\n", text)

    # 清理行首尾空白
    text = re.sub(r"^[ \t]+", "", text, flags=re.MULTILINE)
    text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)

    return normalize_newlines(text.strip())
