# -*- coding: utf-8 -*-
"""验证 U+2029 在 _strip_sep / L3 / coarse 中的完整影响面。"""
import sys
sys.path.insert(0, r"D:\Desktop\Compare")
import src_backend.diff_engine as de

SEP = "\u2029"

# 1. _strip_sep 是否保留 U+2029
test = "abc" + SEP + "def"
result = de._strip_sep(test)
print(f"1. _strip_sep('abc\\u2029def') = {result!r}")
print(f"   U+2029 仍在结果中: {SEP in result}")
print(f"   _PUNCT_CHARS 含 U+2029: {SEP in de._PUNCT_CHARS}")
print(f"   _WS_CHARS 含 U+2029: {SEP in de._WS_CHARS}")
print()

# 2. L3 _resolve_punct_alignment 是否受影响
# 构造 DEL X + ADD Y，X 和 Y 实词相同但 U+2029 位置不同
x = "abc" + SEP + "def"
y = SEP + "abcdef"  # U+2029 在开头而非中间
wx = de._strip_sep(x)
wy = de._strip_sep(y)
print(f"2. L3 场景: X={x!r}, Y={y!r}")
print(f"   _strip_sep(X)={wx!r}, _strip_sep(Y)={wy!r}")
print(f"   实词相同: {wx == wy}")
if wx != wy:
    print(f"   → L3 会判实词不同，放弃重写（但实际只是 U+2029 位置不同）")
print()

# 3. coarse 场景同理
x2 = "經卷第三" + SEP + "東晉譯" + SEP
y2 = SEP + "經卷第三東晉譯" + SEP
wx2 = de._strip_sep(x2)
wy2 = de._strip_sep(y2)
print(f"3. coarse 场景: X={x2!r}, Y={y2!r}")
print(f"   _strip_sep(X)={wx2!r}, _strip_sep(Y)={wy2!r}")
print(f"   实词相同: {wx2 == wy2}")
print()

# 4. 验证修复后：把 U+2029 加入剥离
def strip_sep_fixed(s):
    return "".join(c for c in s if c not in de._PUNCT_CHARS and c not in de._WS_CHARS and c != SEP)

wx_fix = strip_sep_fixed(x)
wy_fix = strip_sep_fixed(y)
print(f"4. 修复后 _strip_sep:")
print(f"   strip_sep_fixed(X)={wx_fix!r}, strip_sep_fixed(Y)={wy_fix!r}")
print(f"   实词相同: {wx_fix == wy_fix}")
print()

# 5. 但要小心：split_by_sep 也需要处理 U+2029
# 当前 split_by_sep 把 U+2029 当实词（不在 PUNCT 也不在 WS）
# 修复后 split_by_sep 也应该把 U+2029 当分隔符
print("5. split_by_sep 中 U+2029 的角色:")
print(f"   当前: U+2029 被当实词（不分离，留在 chars）")
print(f"   修复后: U+2029 应被当分隔符（归入 gaps）")
