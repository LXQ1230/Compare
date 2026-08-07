# -*- coding: utf-8 -*-
"""导出 497 真实 segments（含 style）到 JSON，供前端渲染规模实测（临时脚本）。"""
import json
import sys
sys.path.insert(0, r"D:\Desktop\Compare")
from src_backend.parsers.idml_parser import parse_idml
from src_backend.diff_engine import diff_texts_with_style

A = parse_idml(r"C:\Users\Admin\AppData\Local\Temp\tmpe3mc_lt1.idml")
B = parse_idml(r"C:\Users\Admin\AppData\Local\Temp\tmpm_gjpo3o.idml")

spans_a = [s.to_dict() for s in A.spans]
spans_b = [s.to_dict() for s in B.spans]

segments, stats = diff_texts_with_style(A.text, B.text, spans_a, spans_b)
print("stats:", stats)
print("segments:", len(segments))

out = {
    "segments": segments,
    "meta": {"vertical": True, "leadingRatio": A.meta.leading_ratio},
}
with open(r"D:\Desktop\Compare\scripts\_segs497.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("written scripts/_segs497.json")
