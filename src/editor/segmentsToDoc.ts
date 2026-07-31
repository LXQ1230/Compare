import type { Segment } from "@/types";

export interface DocContent {
  type: "doc";
  content: Array<{ type: "paragraph"; content: TextNode[] }>;
}

interface TextNode {
  type: "text";
  text: string;
  marks?: MarkDef[];
}

interface MarkDef {
  type: string;
}

/**
 * Convert Segment[] to a ProseMirror-compatible JSON doc.
 * Each segment becomes a text node with the appropriate diff mark.
 */
export function segmentsToDoc(segments: Segment[]): DocContent {
  const textNodes: TextNode[] = [];

  for (const s of segments) {
    const marks: MarkDef[] = [];

    if (s.origin === "user") {
      if (s.operation === "add") marks.push({ type: "userAdd" });
      else if (s.operation === "del" || s.operation === "mod") marks.push({ type: "userDel" });
    } else {
      switch (s.operation) {
        case "add": marks.push({ type: "diffAdd" }); break;
        case "del": marks.push({ type: "diffDel" }); break;
        case "mod":
          marks.push({ type: s.side === "old" ? "diffModOld" : "diffModNew" });
          break;
      }
    }

    textNodes.push({ type: "text", text: s.text, marks: marks.length ? marks : undefined });
  }

  return { type: "doc", content: [{ type: "paragraph", content: textNodes }] };
}
