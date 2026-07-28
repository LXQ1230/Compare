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
