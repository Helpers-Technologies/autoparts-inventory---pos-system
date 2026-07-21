import { describe, it, expect } from "vitest";
import { buildXlsx, crc32, columnLetter, escapeXml, type XlsxSheet } from "../../../src/lib/xlsx";

const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
const decodeAll = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

function countSignature(bytes: Uint8Array, sig: number[]): number {
  let count = 0;
  for (let i = 0; i <= bytes.length - sig.length; i++) {
    let match = true;
    for (let j = 0; j < sig.length; j++) {
      if (bytes[i + j] !== sig[j]) {
        match = false;
        break;
      }
    }
    if (match) count++;
  }
  return count;
}

const LOCAL_HEADER_SIG = [0x50, 0x4b, 0x03, 0x04];
const CENTRAL_HEADER_SIG = [0x50, 0x4b, 0x01, 0x02];
const EOCD_SIG = [0x50, 0x4b, 0x05, 0x06];

describe("crc32", () => {
  it("returns 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("matches the canonical check value for '123456789'", () => {
    expect(crc32(encode("123456789"))).toBe(0xcbf43926);
  });

  it("matches the known value for a single byte 'a'", () => {
    expect(crc32(encode("a"))).toBe(0xe8b7be43);
  });

  it("always returns an unsigned 32-bit integer", () => {
    const v = crc32(encode("The quick brown fox jumps over the lazy dog"));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(v)).toBe(true);
  });
});

describe("columnLetter", () => {
  it("maps the first 26 indices to A–Z", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(1)).toBe("B");
    expect(columnLetter(25)).toBe("Z");
  });

  it("maps the two-letter range", () => {
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(27)).toBe("AB");
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
    expect(columnLetter(701)).toBe("ZZ");
  });

  it("maps the first three-letter index", () => {
    expect(columnLetter(702)).toBe("AAA");
  });

  it("throws on a negative index", () => {
    expect(() => columnLetter(-1)).toThrow(RangeError);
  });

  it("throws on a non-integer index", () => {
    expect(() => columnLetter(1.5)).toThrow(RangeError);
  });
});

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml("a & b")).toBe("a &amp; b");
    expect(escapeXml("<tag>")).toBe("&lt;tag&gt;");
    expect(escapeXml('say "hi"')).toBe("say &quot;hi&quot;");
    expect(escapeXml("it's")).toBe("it&apos;s");
  });

  it("escapes ampersands before other entities (no double-escaping)", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });

  it("strips C0 control characters that are invalid in XML", () => {
    const withNull = "a" + String.fromCharCode(0) + "b" + String.fromCharCode(8) + "c";
    expect(escapeXml(withNull)).toBe("abc");
  });

  it("preserves tab, newline and carriage return", () => {
    const s = "a" + String.fromCharCode(9) + String.fromCharCode(10) + String.fromCharCode(13) + "b";
    expect(escapeXml(s)).toBe(s);
  });

  it("returns an empty string unchanged", () => {
    expect(escapeXml("")).toBe("");
  });
});

describe("buildXlsx — package structure", () => {
  const sheet: XlsxSheet = {
    name: "Sales",
    headers: ["Code", "Name", "Total"],
    rows: [
      ["P-1", "Widget", 1500],
      ["P-2", "Gadget", 0],
    ],
  };

  it("starts with the ZIP local file header signature", () => {
    const bytes = buildXlsx([sheet]);
    expect(Array.from(bytes.slice(0, 4))).toEqual(LOCAL_HEADER_SIG);
  });

  it("contains one local + one central header per part, and a single EOCD record", () => {
    const bytes = buildXlsx([sheet]);
    // 6 parts: [Content_Types], _rels/.rels, workbook, workbook.rels, styles, sheet1
    expect(countSignature(bytes, LOCAL_HEADER_SIG)).toBe(6);
    expect(countSignature(bytes, CENTRAL_HEADER_SIG)).toBe(6);
    expect(countSignature(bytes, EOCD_SIG)).toBe(1);
  });

  it("includes all required OOXML parts by name", () => {
    const text = decodeAll(buildXlsx([sheet]));
    expect(text).toContain("[Content_Types].xml");
    expect(text).toContain("_rels/.rels");
    expect(text).toContain("xl/workbook.xml");
    expect(text).toContain("xl/_rels/workbook.xml.rels");
    expect(text).toContain("xl/styles.xml");
    expect(text).toContain("xl/worksheets/sheet1.xml");
  });
});

describe("buildXlsx — worksheet content", () => {
  it("writes numeric cells as native numbers (including zero)", () => {
    const text = decodeAll(
      buildXlsx([{ name: "S", headers: ["n"], rows: [[1500], [0], [-42.5]] }])
    );
    expect(text).toContain("<v>1500</v>");
    expect(text).toContain("<v>0</v>");
    expect(text).toContain("<v>-42.5</v>");
  });

  it("writes text cells as inline strings", () => {
    const text = decodeAll(buildXlsx([{ name: "S", headers: ["t"], rows: [["hello"]] }]));
    expect(text).toContain('t="inlineStr"');
    expect(text).toContain("<t xml:space=\"preserve\">hello</t>");
  });

  it("marks the header row bold (style index 1)", () => {
    const text = decodeAll(buildXlsx([{ name: "S", headers: ["Header"], rows: [] }]));
    expect(text).toContain('<row r="1">');
    expect(text).toContain('s="1"');
    expect(text).toContain(">Header<");
  });

  it("renders the sheet right-to-left for the Arabic UI", () => {
    const text = decodeAll(buildXlsx([{ name: "S", headers: ["h"], rows: [] }]));
    expect(text).toContain('rightToLeft="1"');
  });

  it("escapes XML special characters in cell content", () => {
    const text = decodeAll(buildXlsx([{ name: "S", headers: ["A & B <x>"], rows: [] }]));
    expect(text).toContain("A &amp; B &lt;x&gt;");
  });

  it("preserves Arabic header text", () => {
    const text = decodeAll(buildXlsx([{ name: "S", headers: ["الكود", "الاسم"], rows: [] }]));
    expect(text).toContain("الكود");
    expect(text).toContain("الاسم");
  });

  it("omits empty data cells but keeps later cells correctly referenced", () => {
    const text = decodeAll(buildXlsx([{ name: "S", headers: ["a", "b"], rows: [[null, "x"]] }]));
    expect(text).not.toContain('r="A2"');
    expect(text).toContain('r="B2"');
  });

  it("falls back to a string cell for non-finite numbers", () => {
    const text = decodeAll(buildXlsx([{ name: "S", headers: ["n"], rows: [[NaN]] }]));
    expect(text).toContain(">NaN<");
  });

  it("keeps an empty header cell present (styled, self-closing)", () => {
    const text = decodeAll(buildXlsx([{ name: "S", headers: [""], rows: [] }]));
    expect(text).toContain('<c r="A1" s="1"/>');
  });
});

describe("buildXlsx — sheets and names", () => {
  it("supports multiple sheets", () => {
    const text = decodeAll(
      buildXlsx([
        { name: "First", headers: ["a"], rows: [] },
        { name: "Second", headers: ["b"], rows: [] },
      ])
    );
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("xl/worksheets/sheet2.xml");
    expect(text).toContain('name="First"');
    expect(text).toContain('name="Second"');
  });

  it("sanitises reserved characters out of sheet names and caps length at 31", () => {
    const longName = "Report/2026:Q[1]*final?xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const text = decodeAll(buildXlsx([{ name: longName, headers: ["a"], rows: [] }]));
    expect(text).not.toContain("Report/2026");
    const match = /name="([^"]*)"/.exec(text);
    expect(match).not.toBeNull();
    expect((match?.[1] ?? "").length).toBeLessThanOrEqual(31);
  });

  it("falls back to a default sheet name when the name is empty after sanitising", () => {
    const text = decodeAll(buildXlsx([{ name: "///", headers: ["a"], rows: [] }]));
    expect(text).toContain('name="Sheet1"');
  });

  it("produces a valid package even with no sheets", () => {
    const bytes = buildXlsx([]);
    expect(Array.from(bytes.slice(0, 4))).toEqual(LOCAL_HEADER_SIG);
    expect(decodeAll(bytes)).toContain("xl/worksheets/sheet1.xml");
  });
});
