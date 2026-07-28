"""Diff engine wrapper around google-diff-match-patch."""

from diff_match_patch import diff_match_patch


def diff_texts(orig: str, modified: str) -> tuple[list[dict], dict]:
    """字符级 diff，返回合并后的 segments 和统计信息。"""
    dmp = diff_match_patch()
    raw_diffs = dmp.diff_main(orig, modified, timeout=0)
    dmp.diff_cleanupSemantic(raw_diffs)

    segments: list[dict] = []
    stats = {"total": 0, "add": 0, "del": 0, "mod": 0}
    change_index = 0
    i = 0

    while i < len(raw_diffs):
        op, text = raw_diffs[i]

        if op == 0:  # EQUAL
            segments.append({
                "text": text, "operation": "none", "origin": "original",
            })
            i += 1
            continue

        if op == 1:  # INSERT
            if i + 1 < len(raw_diffs) and raw_diffs[i + 1][0] == -1:
                add_text = text
                del_text = raw_diffs[i + 1][1]
                change_index += 1
                segments.append({
                    "text": del_text, "operation": "mod", "origin": "original",
                    "side": "old", "ci": change_index,
                })
                segments.append({
                    "text": add_text, "operation": "mod", "origin": "original",
                    "side": "new", "ci": change_index,
                })
                stats["mod"] += 1
                stats["total"] += 1
                i += 2
                continue
            else:
                change_index += 1
                segments.append({
                    "text": text, "operation": "add", "origin": "original",
                    "ci": change_index,
                })
                stats["add"] += 1
                stats["total"] += 1
                i += 1
                continue

        if op == -1:  # DELETE
            if i + 1 < len(raw_diffs) and raw_diffs[i + 1][0] == 1:
                del_text = text
                add_text = raw_diffs[i + 1][1]
                change_index += 1
                segments.append({
                    "text": del_text, "operation": "mod", "origin": "original",
                    "side": "old", "ci": change_index,
                })
                segments.append({
                    "text": add_text, "operation": "mod", "origin": "original",
                    "side": "new", "ci": change_index,
                })
                stats["mod"] += 1
                stats["total"] += 1
                i += 2
                continue
            else:
                change_index += 1
                segments.append({
                    "text": text, "operation": "del", "origin": "original",
                    "ci": change_index,
                })
                stats["del"] += 1
                stats["total"] += 1
                i += 1
                continue

    return segments, stats


def make_patches(baseline: str, current: str) -> str:
    dmp = diff_match_patch()
    patches = dmp.patch_make(baseline, current)
    return dmp.patch_toText(patches)


def apply_patches(text: str, patches_text: str) -> tuple[str, list[bool]]:
    dmp = diff_match_patch()
    patches = dmp.patch_fromText(patches_text)
    result, statuses = dmp.patch_apply(patches, text)
    return result, statuses
