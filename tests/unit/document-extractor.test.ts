import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractDocument, isSupportedDocument } from "@policy/rag/index";

function createPdf(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length + 35} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "ascii");
}

async function createDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:t>河北育儿补贴申请材料</w:t></w:r></w:p>
      <w:p><w:r><w:t>居民身份证和户口簿</w:t></w:r></w:p>
    </w:body></w:document>`);
  return await zip.generateAsync({ type: "nodebuffer" });
}

describe("multi-source policy document extraction", () => {
  it("recognizes the bounded input format allowlist", () => {
    for (const name of ["a.md", "a.txt", "a.html", "a.htm", "a.pdf", "a.docx"]) expect(isSupportedDocument(name)).toBe(true);
    expect(isSupportedDocument("a.exe")).toBe(false);
  });

  it("extracts Markdown, UTF-8 text and HTML into normalized text", async () => {
    const markdown = await extractDocument("policy.md", Buffer.from("---\ntitle: 示例\n---\n# 申请条件\n\n具有本地户籍"));
    const text = await extractDocument("policy.txt", Buffer.from("申请材料\r\n\r\n身份证"));
    const html = await extractDocument("policy.html", Buffer.from("<html><body><h1>补贴标准</h1><p>每孩每年 3600 元</p><script>ignore()</script></body></html>"));
    expect(markdown).toMatchObject({ format: "markdown", bodyStartLine: 4 });
    expect(text.text).toContain("身份证");
    expect(html.text).toContain("# 补贴标准");
    expect(html.text).toContain("每孩每年 3600 元");
    expect(html.text).not.toContain("ignore");
  });

  it("extracts text from real PDF and DOCX containers", async () => {
    const pdf = await extractDocument("policy.pdf", createPdf("childcare subsidy 3600"));
    const docx = await extractDocument("policy.docx", await createDocx());
    expect(pdf).toMatchObject({ format: "pdf" });
    expect(pdf.text).toContain("childcare subsidy 3600");
    expect(pdf.text).toContain("第 1 页");
    expect(docx).toMatchObject({ format: "docx" });
    expect(docx.text).toContain("河北育儿补贴申请材料");
    expect(docx.text).toContain("居民身份证和户口簿");
  });
});
