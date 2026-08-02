import { extname } from "node:path";
import mammoth from "mammoth";
import { parse } from "parse5";
import pdfParse from "pdf-parse";
import { PolicyAssistantError } from "@policy/shared/index";

export const EXTRACTION_PIPELINE_VERSION = "policy-extractor-v1";
export const SUPPORTED_DOCUMENT_EXTENSIONS = [".md", ".txt", ".html", ".htm", ".pdf", ".docx"] as const;
export type SupportedDocumentExtension = (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number];
export type SourceFormat = "markdown" | "text" | "html" | "pdf" | "docx";

export type ExtractedDocument = {
  format: SourceFormat;
  text: string;
  warnings: string[];
  bodyStartLine: number;
};

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 2_000_000;
const MAX_PDF_PAGES = 200;

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
};

type PdfTextItem = { str?: string; transform?: number[] };
type PdfPage = {
  pageIndex?: number;
  getTextContent(options: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{
    items: PdfTextItem[];
  }>;
};

function strictUtf8(buffer: Buffer, fileName: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new PolicyAssistantError("INVALID_INPUT", `Knowledge file is not valid UTF-8: ${fileName}`, undefined, error);
  }
}

function markdownBodyStartLine(raw: string): number {
  const lines = raw.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return 1;
  const closing = lines.slice(1).findIndex((line) => line.trim() === "---");
  return closing < 0 ? 1 : closing + 3;
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function htmlToMarkdown(html: string): string {
  const document = parse(html) as unknown as HtmlNode;
  const ignored = new Set(["script", "style", "noscript", "template", "svg"]);
  const blocks = new Set(["p", "div", "section", "article", "main", "header", "footer", "blockquote", "table", "tr"]);

  const render = (node: HtmlNode): string => {
    if (node.nodeName === "#text") return node.value ?? "";
    const tag = node.tagName?.toLowerCase();
    if (tag && ignored.has(tag)) return "";
    const content = (node.childNodes ?? []).map(render).join("");
    if (!tag) return content;
    if (/^h[1-6]$/u.test(tag)) return `\n\n${"#".repeat(Number(tag.slice(1)))} ${content.trim()}\n\n`;
    if (tag === "br") return "\n";
    if (tag === "li") return `\n- ${content.trim()}`;
    if (tag === "td" || tag === "th") return ` ${content.trim()} |`;
    if (blocks.has(tag)) return `\n\n${content.trim()}\n\n`;
    return content;
  };

  return normalizeExtractedText(render(document));
}

async function renderPdfPage(page: PdfPage): Promise<string> {
  const textContent = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  let previousY: number | undefined;
  const lines: string[] = [];
  let line = "";
  for (const item of textContent.items) {
    const text = item.str ?? "";
    const y = item.transform?.[5];
    if (previousY !== undefined && y !== undefined && Math.abs(previousY - y) > 1) {
      if (line.trim()) lines.push(line.trim());
      line = text;
    } else {
      line += `${line && text ? " " : ""}${text}`;
    }
    previousY = y;
  }
  if (line.trim()) lines.push(line.trim());
  const pageNumber = (page.pageIndex ?? 0) + 1;
  return `# 第 ${pageNumber} 页\n\n${lines.join("\n")}`;
}

function assertExtracted(fileName: string, result: ExtractedDocument): ExtractedDocument {
  const text = normalizeExtractedText(result.text);
  if (!text) {
    const hint = result.format === "pdf" ? "（可能是扫描件；本 MVP 不包含 OCR）" : "";
    throw new PolicyAssistantError("INVALID_INPUT", `No extractable text in ${fileName}${hint}`);
  }
  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new PolicyAssistantError("INVALID_INPUT", `Extracted document is too large: ${fileName}`);
  }
  return { ...result, text };
}

export function isSupportedDocument(fileName: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.includes(extname(fileName).toLowerCase() as SupportedDocumentExtension);
}

export async function extractDocument(fileName: string, buffer: Buffer): Promise<ExtractedDocument> {
  if (buffer.byteLength > MAX_SOURCE_BYTES) {
    throw new PolicyAssistantError("INVALID_INPUT", `Knowledge file exceeds 20 MB: ${fileName}`);
  }
  const extension = extname(fileName).toLowerCase() as SupportedDocumentExtension;
  try {
    if (extension === ".md") {
      const raw = strictUtf8(buffer, fileName);
      return assertExtracted(fileName, { format: "markdown", text: raw, warnings: [], bodyStartLine: markdownBodyStartLine(raw) });
    }
    if (extension === ".txt") {
      return assertExtracted(fileName, { format: "text", text: strictUtf8(buffer, fileName), warnings: [], bodyStartLine: 1 });
    }
    if (extension === ".html" || extension === ".htm") {
      const html = strictUtf8(buffer, fileName);
      return assertExtracted(fileName, { format: "html", text: htmlToMarkdown(html), warnings: [], bodyStartLine: 1 });
    }
    if (extension === ".docx") {
      const converted = await mammoth.convertToHtml(
        { buffer },
        {
          externalFileAccess: false,
          convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
        },
      );
      return assertExtracted(fileName, {
        format: "docx",
        text: htmlToMarkdown(converted.value),
        warnings: converted.messages.map((message) => message.message).slice(0, 20),
        bodyStartLine: 1,
      });
    }
    if (extension === ".pdf") {
      const parsed = await pdfParse(buffer, { max: MAX_PDF_PAGES, pagerender: renderPdfPage });
      const warnings = parsed.numpages > parsed.numrender
        ? [`PDF has ${parsed.numpages} pages; only the first ${parsed.numrender} were extracted`]
        : [];
      return assertExtracted(fileName, { format: "pdf", text: parsed.text, warnings, bodyStartLine: 1 });
    }
  } catch (error) {
    if (error instanceof PolicyAssistantError) throw error;
    throw new PolicyAssistantError("INVALID_INPUT", `Failed to extract knowledge file: ${fileName}`, undefined, error);
  }
  throw new PolicyAssistantError("INVALID_INPUT", `Unsupported knowledge file type: ${fileName}`);
}
