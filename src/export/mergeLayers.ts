/**
 * Merge the original comparison layer (view-mode segments) with the user
 * edit layer (edit-mode segments) into ONE complete, statically renderable
 * segment list for edit-mode export.
 *
 * Layer priority: user edits win. Text the user touched shows ONLY the user
 * markers (its original markers are dropped); untouched text keeps the
 * original add/del/mod markers — matching what the editor displays (the user
 * decoration layer covers the diff layer).
 *
 * The merged list covers the ENTIRE final document:
 *  - original del / mod-old phantoms survive where untouched,
 *  - user del / mod-old phantoms are appended where the user removed or
 *    rewrote text.
 *
 * Invariant: `buildDocText(mergeLayers(original, user)) === editedText`
 * (concatenating non-phantom segments yields the applied final document).
 */

import type { Segment } from '@/types';
import { isPhantomSegment, normalizeLineEndings } from '@/render/editClassifier';

interface PlacedSegment {
  seg: Segment;
  /** Baseline offset of this projected segment. */
  start: number;
  end: number;
}

interface PhantomEntry {
  seg: Segment;
  /** Insert before placed[anchor]; anchor ∈ [0, placed.length]. */
  anchor: number;
}

export function mergeLayers(original: Segment[], user: Segment[]): Segment[] {
  // Fast path: no user edits — export the untouched original layer as-is
  // (normalized + change indexes renumbered).
  if (user.length === 0) {
    let ci = 0;
    return original.map((s) => ({
      ...s,
      text: normalizeLineEndings(s.text),
      ci: s.operation === 'none' ? undefined : ++ci,
    }));
  }

  // Flatten the original layer onto the baseline text: projected segments
  // (none / add / mod-new) tile the baseline contiguously; phantom segments
  // (del / mod-old) are anchored between them.
  const placed: PlacedSegment[] = [];
  const phantoms: PhantomEntry[] = [];
  let pos = 0;
  for (const s of original) {
    const text = normalizeLineEndings(s.text);
    if (isPhantomSegment(s)) {
      phantoms.push({ seg: { ...s, text }, anchor: placed.length });
    } else {
      placed.push({ seg: { ...s, text }, start: pos, end: pos + text.length });
      pos += text.length;
    }
  }

  const out: Segment[] = [];
  let p = 0; // placed cursor
  let off = 0; // consumed text offset inside placed[p]
  let pp = 0; // phantom cursor
  let ci = 0; // renumbered change index (unique across both layers)

  /** Emit queued phantoms whose anchor segment has already been emitted. */
  const emitPhantoms = (maxAnchor: number): void => {
    while (pp < phantoms.length && phantoms[pp].anchor <= maxAnchor) {
      out.push({ ...phantoms[pp].seg, ci: ++ci });
      pp++;
    }
  };

  /** Drop phantoms whose anchor segment was covered (hidden) by user edits.
   *
   * Anchor semantics differ by phantom kind:
   *  - del / mod-old both display between placed[anchor-1] and placed[anchor]
   *    (anchor = number of placed segments before them),
   *  - but a del phantom belongs to the segment BEFORE it (its old-text spot),
   *    while a mod-old phantom belongs to the segment AFTER it (its mod-new
   *    partner). When that owning segment is hidden, the phantom goes too. */
  const skipPhantomsOf = (segIndex: number): void => {
    while (pp < phantoms.length) {
      const ph = phantoms[pp];
      const owner = ph.seg.operation === 'del' ? ph.anchor - 1 : ph.anchor;
      if (owner <= segIndex) {
        pp++; // owner already emitted (defensive) or hidden → drop
        continue;
      }
      break;
    }
  };

  /**
   * Consume baseline [cursor, to): original segments there are covered by a
   * user del / mod-old and must be hidden (phantom anchors die with them).
   */
  const consumeTo = (to: number): void => {
    while (p < placed.length && placed[p].start + off < to) {
      const ps = placed[p];
      if (ps.end <= to) {
        skipPhantomsOf(p);
        p++;
        off = 0;
      } else {
        off = to - ps.start; // partial cover: remainder stays for later output
        break;
      }
    }
  };

  /**
   * Emit original segments intersecting baseline [from, to) — a run the user
   * left untouched. Segments are sliced at the run boundary so a coarse
   * original segment split across edited/untouched regions renders correctly.
   */
  const emitRange = (from: number, to: number): void => {
    while (p < placed.length && placed[p].start + off < to) {
      const ps = placed[p];
      const a = Math.max(ps.start + off, from);
      const b = Math.min(ps.end, to);
      if (a < b) {
        emitPhantoms(p);
        const rel = a - ps.start;
        out.push({
          ...ps.seg,
          text: ps.seg.text.slice(rel, rel + (b - a)),
          ci: ps.seg.operation === 'none' ? undefined : ++ci,
        });
      }
      if (ps.end <= b) {
        p++;
        off = 0;
      } else {
        off = b - ps.start;
      }
    }
  };

  let basePos = 0;
  for (const us of user) {
    if (us.operation === 'none') {
      emitRange(basePos, basePos + us.text.length);
      basePos += us.text.length;
      continue;
    }
    if (us.operation === 'del' || (us.operation === 'mod' && us.side === 'old')) {
      consumeTo(basePos + us.text.length);
      basePos += us.text.length;
      out.push({ ...us, ci: ++ci });
      continue;
    }
    // add / mod-new — inserted text consumes no baseline
    out.push({ ...us, ci: ++ci });
  }

  // Trailing phantoms anchored after the last placed segment.
  emitPhantoms(placed.length);

  return out;
}
