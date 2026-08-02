declare module "pdf-parse" {
  export type PdfParseOptions = {
    pagerender?: (page: {
      pageIndex?: number;
      getTextContent(options: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{
        items: Array<{ str?: string; transform?: number[] }>;
      }>;
    }) => Promise<string>;
    max?: number;
    version?: string;
  };

  export type PdfParseResult = {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  };

  export default function pdfParse(buffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
}
