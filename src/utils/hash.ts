/**
 * Simple synchronous hash (FNV-1a) — fast, no async crypto needed.
 *
 * Used for:
 *  - edit-session draft keys (editor store)
 *  - compare session IDs in the URL (/report/:sessionId, rev. 5-3)
 *
 * 32-bit FNV-1a; collisions are acceptable for these identity purposes
 * (same input ⇒ same key; different inputs only *rarely* collide).
 */

export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
