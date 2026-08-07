import sys, time, json
from collections import Counter
sys.path.insert(0, r"D:\Desktop\Compare")
from fastapi.testclient import TestClient
from src_backend.main import app

client = TestClient(app)
A = r"D:\Desktop\JidouInject\done\497\497有图.idml"
B = r"D:\Desktop\JidouInject\done\497\497导出_WD注入.idml"

t0 = time.time()
with open(A, "rb") as fa, open(B, "rb") as fb:
    resp = client.post(
        "/api/compare",
        files={
            "fileA": ("497有图.idml", fa, "application/octet-stream"),
            "fileB": ("497导出_WD注入.idml", fb, "application/octet-stream"),
        },
    )
t1 = time.time()
print("status:", resp.status_code, "| total elapsed:", round(t1 - t0, 1), "s")

if resp.status_code != 200:
    print(resp.text[:500])
    sys.exit(1)

segs = []
stats = None
chunks = 0
doc_meta = None
for line in resp.text.splitlines():
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    if msg["type"] == "meta":
        stats = msg["stats"]
        chunks = msg["totalChunks"]
        doc_meta = msg.get("docMeta")
    elif msg["type"] == "segments":
        segs.extend(msg["data"])

print("stats:", stats)
print("totalChunks:", chunks, "| segments:", len(segs))
print("docMeta keys:", list(doc_meta.keys()) if doc_meta else None)
mod_with_style = sum(1 for s in segs if s["operation"] == "mod" and "style" in s)
print("mod segs with style:", mod_with_style)
print("op distribution:", dict(Counter(s["operation"] for s in segs)))
