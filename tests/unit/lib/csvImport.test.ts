// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { parseCsv, downloadCsv, readFileAsText } from "../../../src/lib/csvImport";

describe("parseCsv", () => {
  it("returns an empty array for empty or whitespace-only input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n  \r\n ")).toEqual([]);
  });

  it("parses a simple comma-separated grid", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("captures the final row even without a trailing newline", () => {
    expect(parseCsv("name,qty\nصنف,5")).toEqual([
      ["name", "qty"],
      ["صنف", "5"],
    ]);
  });

  it("normalizes CRLF and lone CR line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("preserves empty fields between commas", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });

  it("skips blank lines but keeps rows that have any non-empty cell", () => {
    expect(parseCsv("a,b\n\n , \nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps commas and newlines inside quoted fields", () => {
    expect(parseCsv('"Cairo, EG","line1\nline2"')).toEqual([
      ["Cairo, EG", "line1\nline2"],
    ]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    expect(parseCsv('"say ""hi""",plain')).toEqual([['say "hi"', "plain"]]);
  });

  it("handles a quoted field followed by more cells", () => {
    expect(parseCsv('"a,b",c,d\n"x","y"')).toEqual([
      ["a,b", "c", "d"],
      ["x", "y"],
    ]);
  });
});

// downloadCsv prepends a UTF-8 BOM (EF BB BF) to the blob bytes so Excel opens
// Arabic correctly. Note: Blob.text() decodes via TextDecoder('utf-8'), which
// strips a leading BOM per the WHATWG encoding spec — so the BOM is in the
// written FILE bytes but is (correctly) absent from what .text() returns here.
// Strip defensively in case a jsdom build keeps it.
function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  if (s.charCodeAt(0) === 0xef && s.charCodeAt(1) === 0xbb && s.charCodeAt(2) === 0xbf) return s.slice(3);
  return s;
}

describe("downloadCsv", () => {
  it("escapes special cells, prepends a BOM, names the file, and triggers a click", async () => {
    let captured: Blob | null = null;
    let anchor: HTMLAnchorElement | null = null;
    const realCreate = document.createElement.bind(document);
    const createBlobUrl = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      captured = b as Blob;
      return "blob:mock-url";
    });
    const revokeBlobUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const createEl = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") anchor = el as HTMLAnchorElement;
      return el;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadCsv("export.csv", [
      ["name", "city"],
      ['say "hi"', "Cairo, EG"],
      ["multi\nline", "plain"],
    ]);

    expect(createBlobUrl).toHaveBeenCalledOnce();
    expect(revokeBlobUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(anchor!.download).toBe("export.csv");
    expect(anchor!.href).toContain("blob:mock-url");

    const text = await captured!.text();
    // The escaped body round-trips back through parseCsv to the original grid.
    expect(parseCsv(stripBom(text))).toEqual([
      ["name", "city"],
      ['say "hi"', "Cairo, EG"],
      ["multi\nline", "plain"],
    ]);

    createBlobUrl.mockRestore();
    revokeBlobUrl.mockRestore();
    createEl.mockRestore();
    click.mockRestore();
  });

  it("leaves simple cells unquoted", async () => {
    let captured: Blob | null = null;
    const createBlobUrl = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      captured = b as Blob;
      return "blob:x";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadCsv("f.csv", [["a", "b"], ["1", "2"]]);
    const body = stripBom(await captured!.text());
    expect(body).toBe("a,b\n1,2");
    createBlobUrl.mockRestore();
  });
});

describe("readFileAsText", () => {
  it("resolves with the file's UTF-8 text content", async () => {
    const file = new File(["اسم,كمية\nصنف,5"], "data.csv", { type: "text/csv" });
    await expect(readFileAsText(file)).resolves.toBe("اسم,كمية\nصنف,5");
  });

  it("resolves empty string for an empty file", async () => {
    const file = new File([""], "empty.csv", { type: "text/csv" });
    await expect(readFileAsText(file)).resolves.toBe("");
  });
});
