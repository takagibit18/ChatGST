import { createHash } from "node:crypto";
import type { PolicyChunk, PolicyChunker, PolicyDocument } from "./types.js";

type DraftChunk = {
  content: string;
  sectionPath: string[];
  lineStart: number;
  lineEnd: number;
  semanticBoundary: boolean;
};

const chapterPattern = /^(第[一二三四五六七八九十百〇零0-9]+章)\s*(.*)$/u;
const articlePattern = /^(第[一二三四五六七八九十百〇零0-9]+条)\s*(.*)$/u;
const markdownHeadingPattern = /^(#{1,6})\s+(.+)$/u;
const boldHeadingPattern = /^\*\*([^*]{2,80})\*\*$/u;

export class SemanticPolicyChunker implements PolicyChunker {
  constructor(
    private readonly maxChars = 1800,
    private readonly minChars = 100,
  ) {}

  chunk(document: PolicyDocument): PolicyChunk[] {
    const lines = document.body.split(/\r?\n/u);
    const drafts: DraftChunk[] = [];
    const markdownPath: string[] = [];
    let chapter: string | null = null;
    let currentLines: string[] = [];
    let currentPath: string[] = [];
    let currentStart = 0;
    let semanticBoundary = false;

    const flush = (endExclusive: number) => {
      const content = currentLines.join("\n").trim();
      if (content) {
        drafts.push({
          content,
          sectionPath: [...currentPath],
          lineStart: document.bodyStartLine + currentStart,
          lineEnd: document.bodyStartLine + Math.max(currentStart, endExclusive - 1),
          semanticBoundary,
        });
      }
      currentLines = [];
    };

    const start = (line: string, index: number, path: string[], boundary: boolean) => {
      flush(index);
      currentStart = index;
      currentPath = path;
      currentLines = [line];
      semanticBoundary = boundary;
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const trimmed = line.trim();
      const markdown = trimmed.match(markdownHeadingPattern);
      const chapterMatch = trimmed.match(chapterPattern);
      const articleMatch = trimmed.match(articlePattern);
      const bold = trimmed.match(boldHeadingPattern);
      if (markdown) {
        const level = markdown[1]?.length ?? 1;
        const title = markdown[2]?.trim() ?? "unknown";
        markdownPath.splice(level - 1);
        markdownPath[level - 1] = title;
        chapter = null;
        start(line, index, markdownPath.filter(Boolean), true);
      } else if (chapterMatch) {
        chapter = `${chapterMatch[1]}${chapterMatch[2] ? ` ${chapterMatch[2].trim()}` : ""}`;
        start(line, index, [chapter], true);
      } else if (articleMatch) {
        const label = articleMatch[1] ?? "unknown";
        start(line, index, [...(chapter ? [chapter] : markdownPath.filter(Boolean)), label], true);
      } else if (bold && !/[。；：]$/u.test(bold[1] ?? "")) {
        const title = bold[1]?.trim() ?? "unknown";
        start(line, index, [...(chapter ? [chapter] : markdownPath.filter(Boolean)), title], true);
      } else {
        if (currentLines.length === 0) {
          currentStart = index;
          currentPath = chapter ? [chapter] : markdownPath.filter(Boolean);
          semanticBoundary = false;
        }
        currentLines.push(line);
      }
    }
    flush(lines.length);

    const meaningfulDrafts = drafts.filter((draft) => {
      const nonEmpty = draft.content.split(/\r?\n/u).filter((line) => line.trim());
      if (nonEmpty.length !== 1) return true;
      const only = nonEmpty[0]?.trim() ?? "";
      return !(
        markdownHeadingPattern.test(only) ||
        chapterPattern.test(only) ||
        boldHeadingPattern.test(only)
      );
    });
    const split = meaningfulDrafts.flatMap((draft) => this.splitLongDraft(draft));
    const merged: DraftChunk[] = [];
    for (const draft of split) {
      const previous = merged.at(-1);
      const samePath = previous && previous.sectionPath.join("/") === draft.sectionPath.join("/");
      if (
        previous &&
        samePath &&
        !previous.semanticBoundary &&
        !draft.semanticBoundary &&
        previous.content.length < this.minChars &&
        previous.content.length + draft.content.length + 2 <= this.maxChars
      ) {
        previous.content = `${previous.content}\n\n${draft.content}`;
        previous.lineEnd = draft.lineEnd;
      } else {
        merged.push({ ...draft, sectionPath: [...draft.sectionPath] });
      }
    }
    return merged.map((draft, ordinal) => {
      const digest = createHash("sha256")
        .update(`${document.metadata.document_id}:${draft.lineStart}:${draft.lineEnd}:${draft.content}`)
        .digest("hex")
        .slice(0, 20);
      return {
        document_id: document.metadata.document_id,
        chunk_id: `${document.metadata.document_id}:${digest}`,
        title: document.metadata.title,
        content: draft.content,
        section_path: draft.sectionPath,
        line_start: draft.lineStart,
        line_end: draft.lineEnd,
        ordinal,
      };
    });
  }

  private splitLongDraft(draft: DraftChunk): DraftChunk[] {
    if (draft.content.length <= this.maxChars) return [draft];
    const paragraphs = draft.content.split(/\n{2,}/u);
    const output: DraftChunk[] = [];
    let current = "";
    let lineCursor = draft.lineStart;
    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length + 2 > this.maxChars) {
        const lineCount = current.split(/\r?\n/u).length;
        output.push({
          ...draft,
          content: current,
          lineStart: lineCursor,
          lineEnd: lineCursor + lineCount - 1,
        });
        lineCursor += lineCount;
        current = "";
      }
      if (paragraph.length > this.maxChars) {
        const clauses = paragraph.split(/(?<=[。；])/u);
        for (const clause of clauses) {
          if (current && current.length + clause.length > this.maxChars) {
            const lineCount = current.split(/\r?\n/u).length;
            output.push({ ...draft, content: current, lineStart: lineCursor, lineEnd: lineCursor + lineCount - 1 });
            lineCursor += lineCount;
            current = "";
          }
          current += clause;
        }
      } else {
        current = current ? `${current}\n\n${paragraph}` : paragraph;
      }
    }
    if (current) output.push({ ...draft, content: current, lineStart: lineCursor, lineEnd: draft.lineEnd });
    return output;
  }
}
