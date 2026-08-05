/**
 * Simple synchronous hash (FNV-1a) — fast, no async crypto needed.
 *
 * Used for:
 *  - edit-session draft keys (editor store)
 *  - compare session IDs in the URL (/report/:sessionId, rev. 5-3)
 *
 * 32-bit FNV-1a; collisions are acceptable for these identity purposes
 * (same input ⇒ same key; different inputs only *rarely* collide).
 *
 * 方案 P3-4: 维持 32 位不升 64 位——① draftKey 已混入 baseline 全文哈希，
 * 非恶意场景碰撞概率可忽略；② 升 64 位会改变 key 值，导致所有存量草稿
 * 变孤儿（需迁移逻辑，成本 > 收益）。
 */

export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
