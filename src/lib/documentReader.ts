import type { LedgerShareDocument } from "./share";
import { parseLedgerShareDocument } from "./share";
import { recognizeImage } from "./documentFiles";

export interface DocumentTable { name: string; rows: string[][]; }
export interface ReadDocument { name: string; tables: DocumentTable[]; text: string; ledger: LedgerShareDocument | null; scanned: boolean; }
export interface ReadOptions { password?: string; language?: string; encoding?: string; progress?: (page: number, total: number) => void; }
const MAX_BYTES = 40_000_000;
export function parseDelimited(text: string, separator?: string): string[][] {
  const first = text.split(/\r?\n/).slice(0, 10).join("\n");
  const delimiter = separator ?? ["\t", ";", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += char;
    if (rows.length > 20_000 || row.length > 500 || cell.length > 200_000) throw new Error("limit");
  }
  if (quoted) throw new Error("invalid-delimited");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length > 20_000 || row.length > 500) throw new Error("limit");
  return rows;
}
export function groupTextLines(items: { text: string; x: number; y: number; height: number }[]): string[][] {
  const groups: { y: number; height: number; items: typeof items }[] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (!item.text.trim()) continue;
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.y - item.y) <= Math.max(3, Math.min(last.height, item.height) * .45)) last.items.push(item);
    else groups.push({ y: item.y, height: item.height, items: [item] });
  }
  return groups.map((group) => group.items.sort((a, b) => a.x - b.x).map((item) => item.text.trim()));
}
function readableText(bytes: Uint8Array, encoding?: string): string {
  if (encoding && encoding !== "auto") return new TextDecoder(encoding).decode(bytes).replace(/^\ufeff/, "");
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const utf8 = new TextDecoder().decode(bytes);
  return utf8.includes("\ufffd") ? new TextDecoder("windows-1252").decode(bytes) : utf8.replace(/^\ufeff/, "");
}
function ofxRows(text: string): string[][] {
  const rows = [["Date", "Description", "Amount", "Currency", "Type", "Transaction ID"]];
  const currency = /<CURDEF>\s*([^<\r\n]+)/i.exec(text)?.[1]?.trim() ?? "";
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const field = (tag: string) => new RegExp("<" + tag + ">\\s*([^<\\r\\n]+)", "i").exec(block.split(/<\/STMTTRN>/i)[0])?.[1]?.trim() ?? "";
    const date = field("DTPOSTED"); rows.push([date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8), field("NAME") || field("MEMO"), field("TRNAMT"), currency, field("TRNTYPE"), field("FITID")]);
  }
  return rows;
}
function qifRows(text: string): string[][] {
  const rows = [["Date", "Description", "Amount", "Type"]];
  for (const block of text.split(/(?:\r?\n)?\^(?:\r?\n)?/)) {
    const lines = block.split(/\r?\n/); const field = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(1).trim() ?? "";
    if (field("D") && field("T")) rows.push([field("D").replace(/'/g, "/"), field("P") || field("M"), field("T"), ""]);
  }
  return rows;
}
async function readPdf(bytes: Uint8Array, name: string, options: ReadOptions): Promise<ReadDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const root = new URL("pdf-resources/", document.baseURI).href;
  const task = pdfjs.getDocument({ data: bytes, password: options.password || undefined, useSystemFonts: true, cMapUrl: root + "cmaps/", cMapPacked: true, standardFontDataUrl: root + "standard_fonts/", wasmUrl: root + "wasm/" });
  let pdf: Awaited<typeof task.promise>;
  try { pdf = await task.promise; } catch (error) { if ((error as { name?: string }).name === "PasswordException") throw new Error("encrypted"); throw error; }
  try {
    const attachments = await pdf.getAttachments();
    const attachment = attachments && [...attachments.entries()].find(([, value]) => value.filename === "wallet-diary.json");
    if (attachment) {
      const content = attachment[1].content ?? await pdf.getAttachmentContent(attachment[0]);
      if (!content || content.length > 2_000_000) throw new Error("invalid-ledger");
      const ledger = parseLedgerShareDocument(new TextDecoder().decode(content));
      if (ledger) return { name, tables: [], text: "", ledger, scanned: false };
      throw new Error("invalid-ledger");
    }
    if (pdf.numPages > 100) throw new Error("limit");
    const rows: string[][] = []; let scanned = false;
    for (let index = 1; index <= pdf.numPages; index++) {
      options.progress?.(index, pdf.numPages);
      const page = await pdf.getPage(index); const content = await page.getTextContent();
      const items = content.items.filter((item): item is import("pdfjs-dist/types/src/display/api").TextItem => "str" in item);
      let pageRows = groupTextLines(items.map((item) => ({ text: item.str, x: item.transform[4], y: -item.transform[5], height: item.height || 12 })));
      if (pageRows.flat().join("").trim().length < 15) {
        scanned = true;
        const dimensions = page.getViewport({ scale: 1 });
        if (!(dimensions.width > 0 && dimensions.height > 0)) throw new Error("unsupported");
        const scale = Math.min(2.5, 2600 / dimensions.height, 2600 / dimensions.width);
        const viewport = page.getViewport({ scale }); const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        try {
          const context = canvas.getContext("2d"); if (!context) throw new Error("canvas");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("image")), "image/png"));
          pageRows = groupTextLines(await recognizeImage(new Uint8Array(await image.arrayBuffer()), options.language ?? "en"));
        } finally { canvas.width = 0; canvas.height = 0; }
      }
      rows.push(...pageRows); page.cleanup();
      if (rows.length > 20_000) throw new Error("limit");
    }
    return { name, tables: [{ name: "PDF", rows }], text: rows.map((row) => row.join("\t")).join("\n"), ledger: null, scanned };
  } finally { await task.destroy(); }
}
export async function readExpenseDocument(file: File, options: ReadOptions = {}): Promise<ReadDocument> {
  if (file.size > MAX_BYTES) throw new Error("size");
  const bytes = new Uint8Array(await file.arrayBuffer()); const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  const name = file.name; const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (head.includes("%PDF-")) return readPdf(bytes, name, options);
  const image = file.type.startsWith("image/") || [0x89, 0xff, 0x47, 0x42].includes(bytes[0]) && (
    bytes[0] === 0x89 && bytes[1] === 0x50 || bytes[0] === 0xff && bytes[1] === 0xd8 || head.startsWith("GIF8") || head.startsWith("BM")) || head.startsWith("RIFF") && head.includes("WEBP") || head.slice(4, 32).includes("ftyphei");
  if (image) {
    const rows = groupTextLines(await recognizeImage(bytes, options.language ?? "en"));
    return { name, tables: [{ name: "OCR", rows }], text: rows.map((row) => row.join("\t")).join("\n"), ledger: null, scanned: true };
  }
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    const { unzipSync, strFromU8 } = await import("fflate");
    let expandedSize = 0; let entries = 0;
    const files = unzipSync(bytes, { filter: (entry) => {
      expandedSize += entry.originalSize; entries++;
      if (expandedSize > 80_000_000 || entries > 20_000 || entry.originalSize > 30_000_000) throw new Error("limit");
      return ["word/document.xml", "content.xml", "mimetype"].includes(entry.name);
    } });
    const isOdt = files.mimetype && strFromU8(files.mimetype).includes("opendocument.text");
    const xml = files["word/document.xml"] ?? (isOdt ? files["content.xml"] : undefined);
    if (xml) {
      const parsed = new DOMParser().parseFromString(strFromU8(xml), "text/xml");
      if (parsed.querySelector("parsererror")) throw new Error("unsupported");
      const paragraphs = [...parsed.getElementsByTagName("*")].filter((node) => node.localName === "p");
      const text = paragraphs.map((paragraph) => paragraph.textContent ?? "").join("\n");
      if (paragraphs.length > 20_000 || text.length > 10_000_000) throw new Error("limit");
      return { name, tables: [], text, ledger: null, scanned: false };
    }
  }
  if (isZip || bytes[0] === 0xd0 && bytes[1] === 0xcf || ["xls", "xlsx", "ods", "xlsb", "xlsm"].includes(extension)) {
    const xlsx = await import("xlsx");
    let workbook: ReturnType<typeof xlsx.read>;
    try { workbook = xlsx.read(bytes, { type: "array", cellDates: true, password: options.password, sheetRows: 20_002 }); }
    catch (error) { if (/password|encrypted/i.test(String(error))) throw new Error("encrypted"); throw new Error("unsupported"); }
    if (workbook.SheetNames.length > 100) throw new Error("limit");
    const tables = workbook.SheetNames.map((sheet) => {
      const data = workbook.Sheets[sheet];
      const range = xlsx.utils.decode_range(data["!fullref"] ?? data["!ref"] ?? "A1");
      if (range.e.r >= 20_001 || range.e.c >= 500 || (range.e.r + 1) * (range.e.c + 1) > 1_000_000) throw new Error("limit");
      return { name: sheet, rows: xlsx.utils.sheet_to_json<unknown[]>(data, { header: 1, raw: true, defval: "" }).map((row) => row.map((cell) => cell instanceof Date ? `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, "0")}-${String(cell.getDate()).padStart(2, "0")}` : String(cell ?? ""))) };
    });
    if (tables.reduce((sum, table) => sum + table.rows.length, 0) > 20_000) throw new Error("limit");
    return { name, tables, text: tables.map((table) => table.rows.map((row) => row.join("\t")).join("\n")).join("\n"), ledger: null, scanned: false };
  }
  let text = readableText(bytes, options.encoding);
  if (text.includes("\0") || text.length > 10_000_000) throw new Error("unsupported");
  const ledger = parseLedgerShareDocument(text);
  if (ledger) return { name, tables: [], text, ledger, scanned: false };
  if (text.trimStart().startsWith("[") || text.trimStart().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(text);
      const object = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      const items = Array.isArray(parsed) ? parsed : [object.transactions, object.expenses, object.records, object.data].find(Array.isArray);
      if (!Array.isArray(items) || !items.length || items.length > 20_000) throw new Error("unsupported");
      const headers = [...new Set(items.flatMap((item) => item && typeof item === "object" ? Object.keys(item) : []))];
      if (headers.length > 500) throw new Error("limit");
      return { name, tables: [{ name: "JSON", rows: [headers, ...items.map((item) => headers.map((key) => String(item[key] ?? "")))] }], text, ledger: null, scanned: false };
    } catch { throw new Error("unsupported"); }
  }
  if (/<OFX>|<STMTTRN>/i.test(text)) return { name, tables: [{ name: "OFX", rows: ofxRows(text) }], text, ledger: null, scanned: false };
  if (/^!Type:/m.test(text)) return { name, tables: [{ name: "QIF", rows: qifRows(text) }], text, ledger: null, scanned: false };
  if (/<(?:html|table|body)\b/i.test(text)) {
    // Template content stays inert: never attach imported HTML, run scripts,
    // or load bank-document image/iframe URLs while extracting plain text.
    const html = document.createElement("template"); html.innerHTML = text;
    html.content.querySelectorAll("script,style,iframe,object,embed,link,meta,base,img").forEach((node) => node.remove());
    const tables = [...html.content.querySelectorAll("table")].map((table, index) => ({ name: String(index + 1), rows: [...table.querySelectorAll("tr")].map((row) => [...row.querySelectorAll("th,td")].map((cell) => cell.textContent?.trim() ?? "")) }));
    if (tables.reduce((sum, table) => sum + table.rows.length, 0) > 20_000 || tables.some((table) => table.rows.some((row) => row.length > 500))) throw new Error("limit");
    text = html.content.textContent ?? "";
    return { name, tables, text, ledger: null, scanned: false };
  }
  const rows = parseDelimited(text);
  return { name, tables: rows.some((row) => row.length > 1) ? [{ name: extension.toUpperCase() || "TEXT", rows }] : [], text, ledger: null, scanned: false };
}
