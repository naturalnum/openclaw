// @vitest-environment jsdom

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { CHAT_WORKSPACE_FILE_FORMATS } from "../react-app/lib/chat-file-support";
import { buildReadableChatFileSidecars, CHAT_FILE_SIDECAR_EXTENSIONS } from "./chat-file-sidecars";

async function fileText(file: File): Promise<string> {
  return new TextDecoder().decode(await file.arrayBuffer());
}

async function createWordFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>测试论文内容</w:t></w:r></w:p></w:body></w:document>',
  );
  return new File([await zip.generateAsync({ type: "uint8array" })], "report.docx");
}

async function createPresentationFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>演示第一页</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );
  zip.file(
    "ppt/slides/slide2.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>演示第二页</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );
  return new File([await zip.generateAsync({ type: "uint8array" })], "slides.pptx");
}

function createMinimalPdf(text: string): Uint8Array {
  const content = `BT /F1 18 Tf 72 720 Td (${text.replaceAll(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function createSpreadsheetFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="销售表" sheetId="1"/></sheets></workbook>',
  );
  zip.file(
    "xl/sharedStrings.xml",
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>商品</t></si><si><t>苹果</t></si></sst>',
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>数量</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>12</v></c></row></sheetData></worksheet>',
  );
  return new File([await zip.generateAsync({ type: "uint8array" })], "sales.xlsx");
}

async function createOpenDocumentFile(extension: "odt" | "ods" | "odp"): Promise<File> {
  const zip = new JSZip();
  const mimeByExtension = {
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
  } as const;
  const contentByExtension = {
    odt: '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>OpenDocument 第一段</text:p><text:p>第二段内容</text:p></office:text></office:body></office:document-content>',
    ods: '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:body><office:spreadsheet><table:table table:name="库存"><table:table-row><table:table-cell><text:p>商品</text:p></table:table-cell><table:table-cell><text:p>数量</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>苹果</text:p></table:table-cell><table:table-cell><text:p>8</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>',
    odp: '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body><office:presentation><draw:page><text:p>开放演示第一页</text:p></draw:page><draw:page><text:p>开放演示第二页</text:p></draw:page></office:presentation></office:body></office:document-content>',
  } as const;
  zip.file("mimetype", mimeByExtension[extension]);
  zip.file("content.xml", contentByExtension[extension]);
  return new File([await zip.generateAsync({ type: "uint8array" })], `open-document.${extension}`);
}

describe("buildReadableChatFileSidecars", () => {
  it("keeps every accepted binary document format connected to a sidecar extractor", () => {
    const acceptedBinaryDocuments = Object.entries(CHAT_WORKSPACE_FILE_FORMATS)
      .filter(
        ([, kind]) => kind === "document" || kind === "spreadsheet" || kind === "presentation",
      )
      .map(([extension]) => extension)
      .toSorted();
    expect([...CHAT_FILE_SIDECAR_EXTENSIONS].toSorted()).toEqual(acceptedBinaryDocuments);
  });

  it("extracts text from DOCX and PPTX files", async () => {
    const result = await buildReadableChatFileSidecars([
      { name: "report.docx", file: await createWordFile() },
      { name: "slides.pptx", file: await createPresentationFile() },
    ]);

    expect(result.sidecarByFileName.get("report.docx")).toBe("report.docx.txt");
    expect(result.sidecarByFileName.get("slides.pptx")).toBe("slides.pptx.txt");
    expect(result.warningByFileName.size).toBe(0);
    expect(
      await fileText(result.files.find((entry) => entry.name === "report.docx.txt")!.file),
    ).toContain("测试论文内容");
    expect(
      await fileText(result.files.find((entry) => entry.name === "slides.pptx.txt")!.file),
    ).toMatch(/第 1 页/);
  }, 20_000);

  it("extracts spreadsheet cells, PDF text and OpenDocument text", async () => {
    const spreadsheet = await createSpreadsheetFile();
    const pdf = new File([createMinimalPdf("PDF upload works")], "paper.pdf", {
      type: "application/pdf",
    });
    const openDocuments = await Promise.all([
      createOpenDocumentFile("odt"),
      createOpenDocumentFile("ods"),
      createOpenDocumentFile("odp"),
    ]);
    const result = await buildReadableChatFileSidecars([
      { name: spreadsheet.name, file: spreadsheet },
      { name: pdf.name, file: pdf },
      ...openDocuments.map((file) => ({ name: file.name, file })),
    ]);

    const spreadsheetText = await fileText(
      result.files.find((entry) => entry.name === "sales.xlsx.txt")!.file,
    );
    const pdfText = await fileText(
      result.files.find((entry) => entry.name === "paper.pdf.txt")!.file,
    );
    const openDocumentText = await fileText(
      result.files.find((entry) => entry.name === "open-document.odt.txt")!.file,
    );
    const openSpreadsheetText = await fileText(
      result.files.find((entry) => entry.name === "open-document.ods.txt")!.file,
    );
    const openPresentationText = await fileText(
      result.files.find((entry) => entry.name === "open-document.odp.txt")!.file,
    );
    expect(spreadsheetText).toContain("工作表：销售表");
    expect(spreadsheetText).toContain("商品\t数量");
    expect(spreadsheetText).toContain("苹果\t12");
    expect(pdfText).toContain("PDF upload works");
    expect(openDocumentText).toContain("OpenDocument 第一段");
    expect(openSpreadsheetText).toContain("工作表：库存");
    expect(openSpreadsheetText).toContain("苹果\t8");
    expect(openPresentationText).toContain("第 2 页");
    expect(openPresentationText).toContain("开放演示第二页");
  });

  it("keeps malformed binary documents and reports a non-fatal extraction warning", async () => {
    const result = await buildReadableChatFileSidecars([
      { name: "broken.xlsx", file: new File(["not a zip"], "broken.xlsx") },
      {
        name: "scanned.pdf",
        file: new File([createMinimalPdf("")], "scanned.pdf", { type: "application/pdf" }),
      },
    ]);

    expect(result.files.map((entry) => entry.name)).toEqual(["broken.xlsx", "scanned.pdf"]);
    expect(result.sidecarByFileName.has("broken.xlsx")).toBe(false);
    expect(result.warningByFileName.get("broken.xlsx")).toContain("XLSX 内容提取失败");
    expect(result.warningByFileName.get("scanned.pdf")).toContain("扫描件");
  });

  it("does not create redundant sidecars for directly readable text files", async () => {
    const result = await buildReadableChatFileSidecars([
      { name: "notes.md", file: new File(["hello"], "notes.md") },
    ]);
    expect(result.files).toHaveLength(1);
    expect(result.sidecarByFileName.size).toBe(0);
    expect(result.warningByFileName.size).toBe(0);
  });
});
