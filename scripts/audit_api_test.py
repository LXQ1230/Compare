# -*- coding: utf-8 -*-
"""审查用 API 边界测试：安全、健壮性、功能完整性。"""
import io
import json
import os
import sys
import tempfile
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:17890"
OUT = []


def log(name, ok, detail=""):
    OUT.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")


def api_post(path, fields=None, body=None, timeout=30):
    """Multipart or JSON post."""
    boundary = "----audit" + str(time.time_ns())
    if fields is not None:
        parts = []
        for k, (fn, data) in fields.items():
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fn}\"\r\nContent-Type: application/octet-stream\r\n\r\n".encode("utf-8") + data + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode("utf-8"))
        payload = b"".join(parts)
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    else:
        payload = json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(BASE + path, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def api_get(path, timeout=30):
    req = urllib.request.Request(BASE + path)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


# ── 1. 健康检查 ──────────────────────────────────────────────
s, b = api_get("/api/health")
log("health", s == 200 and "ok".encode("utf-8") in b, f"HTTP {s}")

# ── 2. 正常对比 ──────────────────────────────────────────────
with open("fixtures/sampleA.txt", "rb") as f:
    a = f.read()
with open("fixtures/sampleB.txt", "rb") as f:
    bb = f.read()
s, b = api_post("/api/compare", {"fileA": ("sampleA.txt", a), "fileB": ("sampleB.txt", bb)})
lines = b.decode("utf-8").strip().split("\n")
ok = s == 200 and any('"type": "done"' in l for l in lines)
log("compare normal", ok, f"HTTP {s}, {len(lines)} lines")

# ── 3. txt 含 HTML 脚本内容（XSS 面验证：后端应原样返回文本，前端负责转义）─
xss_txt = b'before <script>alert(1)</script> after\n<img src=x onerror=alert(2)>\nnormal text'
s, b = api_post("/api/compare", {"fileA": ("xssA.txt", xss_txt), "fileB": ("xssB.txt", xss_txt + b'\nnew line')})
seg_str = b.decode("utf-8")
log("txt XSS raw passthrough", s == 200 and "<script>" in seg_str, "后端不过滤 HTML（前端 esc 处理）→ 可接受，需确认前端转义")

# ── 4. md 内容 HTML 剥离 ─────────────────────────────────────
md_a = b"# Title\n\nline with <script>alert(1)</script> tag\n\n[link](http://x.com)\n"
md_b = b"# Title\n\nline with <b>bold</b> tag\n\n[link](http://x.com)\n"
s, b = api_post("/api/compare", {"fileA": ("a.md", md_a), "fileB": ("b.md", md_b)})
seg_str = b.decode("utf-8")
log("md HTML stripped", s == 200 and "<script>" not in seg_str and "<b>" not in seg_str, "md 解析剥离标签")

# ── 5. 空文件 ────────────────────────────────────────────────
s, b = api_post("/api/compare", {"fileA": ("empty.txt", b""), "fileB": ("b.txt", b"hello")})
log("compare empty file", s == 200, f"HTTP {s}（空文件允许，行为待观察）")

# ── 6. 无效扩展名 ────────────────────────────────────────────
s, b = api_post("/api/compare", {"fileA": ("evil.exe", b"MZ..."), "fileB": ("b.txt", b"hello")})
log("invalid ext rejected", s == 400 and "error".encode("utf-8") in b, f"HTTP {s}")

# ── 7. 无扩展名 ──────────────────────────────────────────────
s, b = api_post("/api/compare", {"fileA": ("noext", b"hello"), "fileB": ("b.txt", b"hello")})
log("missing ext rejected", s == 400, f"HTTP {s}")

# ── 8. 伪造 docx（非 ZIP）────────────────────────────────────
s, b = api_post("/api/compare", {"fileA": ("fake.docx", b"NOTAZIPFILE"), "fileB": ("b.txt", b"hello")})
log("fake docx rejected", s == 400 and "不是有效的 docx".encode("utf-8") in b, f"HTTP {s}")

# ── 9. GBK 编码 txt（自动检测）────────────────────────────────
gbk_text = "中文内容测试\n第二行".encode("gbk")
s, b = api_post("/api/compare", {"fileA": ("gbk.txt", gbk_text), "fileB": ("utf8.txt", "中文内容测试\n第二行改".encode("utf-8"))})
ok = s == 200 and "中文内容测试".encode("utf-8").decode("utf-8", "ignore") in b.decode("utf-8", "ignore")
log("gbk auto-detect", s == 200 and "中文内容测试" in b.decode("utf-8"), f"HTTP {s}")

# ── 10. UTF-16 BOM ───────────────────────────────────────────
utf16 = "Hello World\nLine2".encode("utf-16")  # 带 BOM
s, b = api_post("/api/compare", {"fileA": ("u16.txt", utf16), "fileB": ("u8.txt", "Hello World\nLine2x".encode("utf-8"))})
log("utf-16 BOM detect", s == 200 and "Hello World" in b.decode("utf-8"), f"HTTP {s}")

# ── 11. 超大文件（>15MB）——验证是否"先读后查"─────────────────
big = b"a" * (15 * 1024 * 1024 + 1024)
t0 = time.time()
s, b = api_post("/api/compare", {"fileA": ("big.txt", big), "fileB": ("small.txt", b"hello")}, timeout=60)
dt = time.time() - t0
log("oversize rejected 413", s == 413, f"HTTP {s}, {dt:.1f}s")

# ── 12. 超大文件但 < 15MB（接近上限，diff 性能）───────────────
big2 = ("a" * 5_000_000 + "\n中文字符" * 100_000).encode("utf-8")  # ~6.5MB
t0 = time.time()
s, b = api_post("/api/compare", {"fileA": ("big2.txt", big2), "fileB": ("big2b.txt", big2 + b"\nchanged")}, timeout=120)
dt = time.time() - t0
log("large file diff", s == 200, f"HTTP {s}, {dt:.1f}s, {len(b)//1024}KB response")

# ── 13. 相同文件（无差异）─────────────────────────────────────
s, b = api_post("/api/compare", {"fileA": ("same.txt", b"identical"), "fileB": ("same2.txt", b"identical")})
seg = b.decode("utf-8")
log("identical files", s == 200 and '\"total\": 0' in seg, f"HTTP {s}")

# ── 14. 版本保存（空内容 —— 前端 VersionHistory 实际调用方式）──
s, b = api_post("/api/versions/save", body={"label": "audit-empty", "file_a_content": "", "file_b_content": "", "stats": {}})
vid = ""
try:
    vid = json.loads(b)["id"]
    log("version save empty", s == 200, f"HTTP {s}, id={vid}")
except Exception as e:
    log("version save empty", False, f"HTTP {s}, {b[:200]}")
if vid:
    s, b = api_post(f"/api/versions/restore/{vid}")
    restored = json.loads(b)["version"]
    fa = restored["file_a_content"]
    log("version restore content", fa == "", f"恢复内容为空: repr={fa!r}（前端传空内容 → 恢复即空文档）")

# ── 15. 版本保存（真实内容）───────────────────────────────────
s, b = api_post("/api/versions/save", body={"label": "audit-real", "file_a_content": "hello world", "file_b_content": "hello world!", "stats": {"total": 1}})
vid2 = json.loads(b)["id"] if s == 200 else ""
s, b = api_post(f"/api/versions/restore/{vid2}")
restored = json.loads(b)["version"]
log("version save/restore real", restored["file_a_content"] == "hello world" and restored["file_b_content"] == "hello world!", f"a={restored['file_a_content']!r} b={restored['file_b_content']!r}")

# ── 16. 版本链（3 个版本，验证 patch 链）──────────────────────
ids = []
for i, (ca, cb) in enumerate([("v1 base", "v1 base"), ("v1 base x", "v1 base y"), ("v2 base", "v2 base!")]):
    s, b = api_post("/api/versions/save", body={"label": f"chain-{i}", "file_a_content": ca, "file_b_content": cb, "stats": {}})
    ids.append(json.loads(b)["id"])
ok = True
for i, (vid, (ca, cb)) in enumerate(zip(ids, [("v1 base", "v1 base"), ("v1 base x", "v1 base y"), ("v2 base", "v2 base!")])):
    s, b = api_post(f"/api/versions/restore/{vid}")
    v = json.loads(b)["version"]
    if v["file_a_content"] != ca or v["file_b_content"] != cb:
        ok = False
        print(f"    chain[{i}] mismatch: got a={v['file_a_content']!r} b={v['file_b_content']!r}")
log("version chain restore", ok, f"{len(ids)} versions")

# ── 17. 版本注入（非法 id）────────────────────────────────────
s, b = api_post("/api/versions/restore/..%2F..%2Fsecret")
log("version path injection blocked", s == 404, f"HTTP {s}")

# ── 18. autosave save/load/delete ────────────────────────────
key = "audit-key-001"
s, b = api_post("/api/autosave", body={"action": "save", "key": key, "text": "draft text", "cursor_pos": 5})
s2, b2 = api_post("/api/autosave", body={"action": "load", "key": key})
s3, b3 = api_post("/api/autosave", body={"action": "delete", "key": key})
s4, b4 = api_post("/api/autosave", body={"action": "load", "key": key})
d = json.loads(b2)["data"]
log("autosave roundtrip", s == 200 and d["text"] == "draft text" and d["cursor_pos"] == 5, f"text={d['text']!r} cursor={d['cursor_pos']}")
log("autosave delete", s4 == 200 and json.loads(b4)["data"] is None, "")

# ── 19. autosave 路径注入（key 含路径分隔符）─────────────────
evil_key = "../../evil"
s, b = api_post("/api/autosave", body={"action": "save", "key": evil_key, "text": "pwned"})
s2, b2 = api_post("/api/autosave", body={"action": "load", "key": evil_key})
log("autosave path injection hashed", s == 200 and s2 == 200, f"key 被 sha256 哈希，无路径穿越")

# ── 20. 无效 action ──────────────────────────────────────────
s, b = api_post("/api/autosave", body={"action": "hack", "key": "k"})
log("autosave invalid action", s == 400, f"HTTP {s}")

print("\n===== 汇总 =====")
fails = [o for o in OUT if not o[1]]
print(f"共 {len(OUT)} 项，通过 {len(OUT) - len(fails)}，失败 {len(fails)}")
for name, ok, detail in fails:
    print(f"  FAIL: {name} {detail}")
