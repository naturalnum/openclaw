import type { WorkbenchUploadedFile } from "./workbench-adapter";

const MAX_EXTRACTED_TEXT_CHARS = 500_000;

export const CHAT_FILE_SIDECAR_EXTENSIONS = new Set([
  "docx",
  "docm",
  "odt",
  "xlsx",
  "xlsm",
  "ods",
  "pptx",
  "ppsx",
  "odp",
  "pdf",
]);

export type ReadableChatFilePreparation = {
  files: WorkbenchUploadedFile[];
  sidecarByFileName: Map<string, string>;
  warningByFileName: Map<string, string>;
};

function fileExtension(name: string): string {
  const normalized = name.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index + 1) : "";
}

function clampExtractedText(text: string): string {
  const normalized = text.replaceAll("\u0000", "").trim();
  if (normalized.length <= MAX_EXTRACTED_TEXT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n\n[内容过长，已截取前 ${MAX_EXTRACTED_TEXT_CHARS} 个字符]`;
}

function parseXml(xml: string, label: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = Array.from(document.getElementsByTagName("*")).find(
    (element) => element.localName === "parsererror",
  );
  if (parseError) {
    throw new Error(`${label} XML 解析失败`);
  }
  return document;
}

function elementsByLocalName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter(
    (element) => element.localName === localName,
  );
}

function elementText(root: Document | Element, localName: string): string {
  return elementsByLocalName(root, localName)
    .map((element) => element.textContent ?? "")
    .join("");
}

function numericSuffix(path: string, prefix: string): number {
  const match = path.match(new RegExp(`${prefix}(\\d+)\\.xml$`));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function extractWordText(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value ?? "";
}

async function extractSpreadsheetText(file: File): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const sharedStringsEntry = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? elementsByLocalName(
        parseXml(await sharedStringsEntry.async("text"), "Excel sharedStrings"),
        "si",
      ).map((entry) => elementText(entry, "t"))
    : [];

  const workbookEntry = zip.file("xl/workbook.xml");
  const sheetNames = workbookEntry
    ? elementsByLocalName(
        parseXml(await workbookEntry.async("text"), "Excel workbook"),
        "sheet",
      ).map((entry) => entry.getAttribute("name")?.trim() || "工作表")
    : [];
  const worksheetEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .toSorted(
      (left, right) => numericSuffix(left.name, "sheet") - numericSuffix(right.name, "sheet"),
    );

  const output: string[] = [];
  for (let sheetIndex = 0; sheetIndex < worksheetEntries.length; sheetIndex += 1) {
    const worksheet = worksheetEntries[sheetIndex];
    const document = parseXml(await worksheet.async("text"), `Excel ${worksheet.name}`);
    const rows: string[] = [];
    for (const row of elementsByLocalName(document, "row")) {
      const cells: string[] = [];
      let previousColumn = 0;
      for (const cell of elementsByLocalName(row, "c")) {
        const reference = cell.getAttribute("r") ?? "";
        const columnLetters = reference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "";
        let column = 0;
        for (const letter of columnLetters) {
          column = column * 26 + letter.charCodeAt(0) - 64;
        }
        const missingCells = column > 0 ? Math.max(0, column - previousColumn - 1) : 0;
        cells.push(...Array.from({ length: missingCells }, () => ""));
        const type = cell.getAttribute("t") ?? "";
        const rawValue = elementText(cell, "v");
        const formula = elementText(cell, "f");
        let value = rawValue;
        if (type === "s") {
          value = sharedStrings[Number(rawValue)] ?? rawValue;
        } else if (type === "inlineStr" || type === "str") {
          value = elementText(cell, "t") || rawValue;
        } else if (type === "b") {
          value = rawValue === "1" ? "TRUE" : "FALSE";
        } else if (!value && formula) {
          value = `=${formula}`;
        }
        cells.push(value.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " "));
        previousColumn = column || previousColumn + missingCells + 1;
      }
      if (cells.some((cell) => cell.length > 0)) {
        rows.push(cells.join("\t"));
      }
    }
    if (rows.length > 0) {
      output.push(
        `# 工作表：${sheetNames[sheetIndex] ?? `Sheet ${sheetIndex + 1}`}\n${rows.join("\n")}`,
      );
    }
  }
  return output.join("\n\n");
}

async function extractPresentationText(file: File): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
    .toSorted(
      (left, right) => numericSuffix(left.name, "slide") - numericSuffix(right.name, "slide"),
    );
  const slides: string[] = [];
  for (let index = 0; index < slideEntries.length; index += 1) {
    const slide = slideEntries[index];
    const document = parseXml(await slide.async("text"), `PowerPoint ${slide.name}`);
    const paragraphs = elementsByLocalName(document, "p")
      .map((paragraph) => elementText(paragraph, "t").trim())
      .filter(Boolean);
    const text = paragraphs.length > 0 ? paragraphs.join("\n") : elementText(document, "t").trim();
    if (text) {
      slides.push(`# 第 ${index + 1} 页\n${text}`);
    }
  }
  return slides.join("\n\n");
}

async function extractOpenDocumentText(
  file: File,
  kind: "document" | "spreadsheet" | "presentation",
): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const contentEntry = zip.file("content.xml");
  if (!contentEntry) {
    throw new Error("OpenDocument content.xml 缺失");
  }
  const document = parseXml(await contentEntry.async("text"), "OpenDocument content");
  if (kind === "document") {
    return elementsByLocalName(document, "p")
      .map((paragraph) => paragraph.textContent?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "presentation") {
    return elementsByLocalName(document, "page")
      .map((page, index) => {
        const text = elementsByLocalName(page, "p")
          .map((paragraph) => paragraph.textContent?.trim() ?? "")
          .filter(Boolean)
          .join("\n");
        return text ? `# 第 ${index + 1} 页\n${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return elementsByLocalName(document, "table")
    .map((table, tableIndex) => {
      const name =
        Array.from(table.attributes).find((attribute) => attribute.localName === "name")?.value ??
        `Sheet ${tableIndex + 1}`;
      const rows = elementsByLocalName(table, "table-row")
        .map((row) =>
          elementsByLocalName(row, "table-cell")
            .map((cell) =>
              elementsByLocalName(cell, "p")
                .map((paragraph) => paragraph.textContent?.trim() ?? "")
                .filter(Boolean)
                .join(" "),
            )
            .join("\t"),
        )
        .filter((row) => row.replaceAll("\t", "").trim().length > 0);
      return rows.length > 0 ? `# 工作表：${name}\n${rows.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

async function extractPdfText(file: File): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableWorker: true,
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" ")
        .trim();
      if (text) {
        pages.push(`# 第 ${pageNumber} 页\n${text}`);
      }
      if (pages.join("\n\n").length >= MAX_EXTRACTED_TEXT_CHARS) {
        break;
      }
    }
  } finally {
    await (document as typeof document & { destroy?: () => Promise<void> }).destroy?.();
  }
  return pages.join("\n\n");
}

async function extractReadableText(entry: WorkbenchUploadedFile): Promise<string | null> {
  switch (fileExtension(entry.name)) {
    case "docx":
    case "docm":
      return await extractWordText(entry.file);
    case "odt":
      return await extractOpenDocumentText(entry.file, "document");
    case "xlsx":
    case "xlsm":
      return await extractSpreadsheetText(entry.file);
    case "ods":
      return await extractOpenDocumentText(entry.file, "spreadsheet");
    case "pptx":
    case "ppsx":
      return await extractPresentationText(entry.file);
    case "odp":
      return await extractOpenDocumentText(entry.file, "presentation");
    case "pdf":
      return await extractPdfText(entry.file);
    default:
      return null;
  }
}

function extractionFailureMessage(name: string, error?: unknown): string {
  const extension = fileExtension(name).toUpperCase() || "文件";
  if (extension === "PDF") {
    return "PDF 未提取到可读文字；若为扫描件，请改用支持图片的模型或先进行 OCR。";
  }
  const detail = error instanceof Error ? error.message.trim() : "";
  return `${extension} 内容提取失败${detail ? `：${detail}` : ""}，已保留原文件。`;
}

export async function buildReadableChatFileSidecars(
  files: WorkbenchUploadedFile[],
): Promise<ReadableChatFilePreparation> {
  const uploadFiles = [...files];
  const sidecarByFileName = new Map<string, string>();
  const warningByFileName = new Map<string, string>();
  for (const entry of files) {
    let extracted: string | null;
    try {
      extracted = await extractReadableText(entry);
    } catch (error) {
      warningByFileName.set(entry.name, extractionFailureMessage(entry.name, error));
      continue;
    }
    if (extracted === null) {
      continue;
    }
    const text = clampExtractedText(extracted);
    if (!text) {
      warningByFileName.set(entry.name, extractionFailureMessage(entry.name));
      continue;
    }
    const sidecarName = `${entry.name}.txt`;
    uploadFiles.push({
      name: sidecarName,
      file: new File([text], sidecarName, { type: "text/plain;charset=utf-8" }),
    });
    sidecarByFileName.set(entry.name, sidecarName);
  }
  return { files: uploadFiles, sidecarByFileName, warningByFileName };
}
