/**
 * Zero-dependency XLSX (OOXML SpreadsheetML) writer.
 *
 * Produces a genuine `.xlsx` workbook — a ZIP archive of XML parts — without any
 * third-party library. This is deliberate: the popular `xlsx` (SheetJS) and
 * `exceljs` packages add significant bundle weight and carry a history of CVEs
 * (prototype pollution / ReDoS), a poor fit for this security-hardened Electron
 * build (asar integrity, sandbox, fuses).
 *
 * Design notes:
 * - Numbers are written as native numeric cells, so Excel sorts/sums them as
 *   numbers (the old CSV export coerced everything to text).
 * - Text uses inline strings (`t="inlineStr"`), so no shared-string table is
 *   needed and Arabic content is preserved without BOM hacks or comma escaping.
 * - The header row is bold; sheets render right-to-left to match the Arabic UI.
 * - ZIP entries use the STORE method (no compression) — keeps the writer tiny and
 *   dependency-free; export files are small enough that size is a non-issue.
 */

export type XlsxCell = string | number | null | undefined;

export interface XlsxSheet {
  /** Sheet tab name (sanitised to Excel's 31-char / reserved-char rules). */
  name: string;
  /** Header row — rendered bold. */
  headers: string[];
  /** Data rows. Cells may be string, number, or empty (null/undefined). */
  rows: XlsxCell[][];
}

// ── CRC-32 (IEEE, as required by the ZIP format) ────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Cell / column helpers ───────────────────────────────────────────────────────

/** Convert a 0-based column index to its spreadsheet letter (0 → "A", 26 → "AA"). */
export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`Invalid column index: ${index}`);
  }
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

// XML 1.0 forbids most C0 control characters except tab (0x09), LF (0x0A) and CR (0x0D).
// Stripped by char code so this source file stays free of literal control bytes.
function stripInvalidXmlChars(value: string): string {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    result += value[i];
  }
  return result;
}

export function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeSheetName(name: string, fallback: string): string {
  // Excel forbids \ / ? * [ ] : in sheet names and caps length at 31 chars.
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
  return cleaned.length > 0 ? cleaned : fallback;
}

function cellXml(ref: string, value: XlsxCell, styleIndex: number): string {
  const styleAttr = styleIndex > 0 ? ` s="${styleIndex}"` : "";
  if (value === null || value === undefined || value === "") {
    // Keep styled (header) cells present; omit plain empty data cells entirely.
    return styleIndex > 0 ? `<c r="${ref}"${styleAttr}/>` : "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  }
  const text = escapeXml(String(value));
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

// ── XML part builders ───────────────────────────────────────────────────────────

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function buildWorksheetXml(sheet: XlsxSheet): string {
  const colCount = Math.max(sheet.headers.length, ...sheet.rows.map((r) => r.length), 1);

  // Approximate column widths from content length so columns aren't truncated.
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let maxLen = sheet.headers[c] ? String(sheet.headers[c]).length : 0;
    for (const row of sheet.rows) {
      const v = row[c];
      if (v !== null && v !== undefined) {
        maxLen = Math.max(maxLen, String(v).length);
      }
    }
    widths.push(Math.min(60, Math.max(10, maxLen + 2)));
  }

  const colsXml =
    "<cols>" +
    widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") +
    "</cols>";

  const rows: string[] = [];

  const headerCells = sheet.headers.map((h, c) => cellXml(`${columnLetter(c)}1`, h, 1)).join("");
  rows.push(`<row r="1">${headerCells}</row>`);

  sheet.rows.forEach((row, rIdx) => {
    const rowNum = rIdx + 2;
    const cells = row.map((value, c) => cellXml(`${columnLetter(c)}${rowNum}`, value, 0)).join("");
    rows.push(`<row r="${rowNum}">${cells}</row>`);
  });

  return (
    XML_HEADER +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    colsXml +
    `<sheetData>${rows.join("")}</sheetData>` +
    "</worksheet>"
  );
}

function contentTypesXml(sheetCount: number): string {
  const overrides: string[] = [];
  for (let i = 1; i <= sheetCount; i++) {
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
  }
  return (
    XML_HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    overrides.join("") +
    "</Types>"
  );
}

const ROOT_RELS_XML =
  XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

function workbookXml(sheets: XlsxSheet[]): string {
  const sheetTags = sheets
    .map(
      (s, i) =>
        `<sheet name="${escapeXml(sanitizeSheetName(s.name, `Sheet${i + 1}`))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join("");
  return (
    XML_HEADER +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheetTags}</sheets>` +
    "</workbook>"
  );
}

function workbookRelsXml(sheetCount: number): string {
  const rels: string[] = [];
  for (let i = 1; i <= sheetCount; i++) {
    rels.push(
      `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`
    );
  }
  rels.push(
    `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
  );
  return (
    XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels.join("") +
    "</Relationships>"
  );
}

const STYLES_XML =
  XML_HEADER +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  "</fonts>" +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  "</cellXfs>" +
  "</styleSheet>";

// ── Minimal ZIP writer (STORE method) ───────────────────────────────────────────

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

// Fixed DOS timestamp: 1980-01-01 00:00:00 (a valid date; avoids a zero month/day).
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const header: number[] = [];
    header.push(...u32(0x04034b50)); // local file header signature
    header.push(...u16(20)); // version needed to extract
    header.push(...u16(0x0800)); // general purpose flag: UTF-8 filenames
    header.push(...u16(0)); // compression method: store
    header.push(...u16(DOS_TIME));
    header.push(...u16(DOS_DATE));
    header.push(...u32(crc));
    header.push(...u32(size)); // compressed size
    header.push(...u32(size)); // uncompressed size
    header.push(...u16(nameBytes.length));
    header.push(...u16(0)); // extra field length
    for (const b of nameBytes) header.push(b);
    for (const b of entry.data) header.push(b);

    central.push(...u32(0x02014b50)); // central directory header signature
    central.push(...u16(20)); // version made by
    central.push(...u16(20)); // version needed to extract
    central.push(...u16(0x0800));
    central.push(...u16(0));
    central.push(...u16(DOS_TIME));
    central.push(...u16(DOS_DATE));
    central.push(...u32(crc));
    central.push(...u32(size));
    central.push(...u32(size));
    central.push(...u16(nameBytes.length));
    central.push(...u16(0)); // extra field length
    central.push(...u16(0)); // file comment length
    central.push(...u16(0)); // disk number start
    central.push(...u16(0)); // internal file attributes
    central.push(...u32(0)); // external file attributes
    central.push(...u32(offset)); // relative offset of local header
    for (const b of nameBytes) central.push(b);

    local.push(...header);
    offset += header.length;
  }

  const centralOffset = offset;
  const centralSize = central.length;

  const end: number[] = [];
  end.push(...u32(0x06054b50)); // end of central directory signature
  end.push(...u16(0)); // number of this disk
  end.push(...u16(0)); // disk where central directory starts
  end.push(...u16(entries.length)); // central directory records on this disk
  end.push(...u16(entries.length)); // total central directory records
  end.push(...u32(centralSize));
  end.push(...u32(centralOffset));
  end.push(...u16(0)); // comment length

  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Trigger a browser download of a single-sheet xlsx file.
 * Use this when the data is already available in the renderer (no need to
 * go through AppContext / ReportingContext for the export).
 */
export function downloadXlsxFile(sheet: XlsxSheet, filename: string): void {
  const bytes = buildXlsx([sheet]);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Build a complete `.xlsx` workbook from one or more sheets. */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array<ArrayBuffer> {
  const effective = sheets.length > 0 ? sheets : [{ name: "Sheet1", headers: [], rows: [] }];
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypesXml(effective.length)) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS_XML) },
    { name: "xl/workbook.xml", data: encoder.encode(workbookXml(effective)) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRelsXml(effective.length)) },
    { name: "xl/styles.xml", data: encoder.encode(STYLES_XML) },
  ];
  effective.forEach((sheet, i) => {
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(buildWorksheetXml(sheet)) });
  });
  return zip(entries);
}
