import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const bundle = require("../../../scripts/fixture-bundle.cjs") as {
  writeFixtureBundle: (dataset: Record<string, unknown>, directory: string) => {
    sha256: string;
    bytes: number;
  };
  loadFixtureBundle: (source: string) => Record<string, unknown>;
};

const temporaryDirectories: string[] = [];
function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-fixture-bundle-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("deterministic scale fixture bundle", () => {
  const dataset = {
    _fixtureMetadata: { generatorVersion: "test", seed: 42 },
    products: [{ id: "p-1", quantity: 3 }, { id: "p-2", quantity: 0 }],
    salesInvoices: [{ id: "s-1", lines: [{ productId: "p-1", quantity: 1 }] }],
    settings: { companyName: "اختبار" },
    nextProductCode: 3,
  };

  it("writes identical aggregate hashes and reloads identical data", () => {
    const first = bundle.writeFixtureBundle(dataset, temporaryDirectory());
    const secondDirectory = temporaryDirectory();
    const second = bundle.writeFixtureBundle(dataset, secondDirectory);

    expect(second.sha256).toBe(first.sha256);
    expect(second.bytes).toBe(first.bytes);
    expect(bundle.loadFixtureBundle(secondDirectory)).toEqual(dataset);
  });

  it("rejects a collection chunk whose contents no longer match its manifest", () => {
    const directory = temporaryDirectory();
    bundle.writeFixtureBundle(dataset, directory);
    const index = JSON.parse(fs.readFileSync(path.join(directory, "index.json"), "utf8"));
    const products = index.entries.find((entry: { name: string }) => entry.name === "products");
    const chunkPath = path.join(directory, ...products.files[0].path.split("/"));
    fs.appendFileSync(chunkPath, " ");

    expect(() => bundle.loadFixtureBundle(directory)).toThrow(/checksum mismatch/);
  });

  it("keeps compatibility with legacy single-file JSON fixtures", () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "legacy.json");
    fs.writeFileSync(file, JSON.stringify(dataset));
    expect(bundle.loadFixtureBundle(file)).toEqual(dataset);
  });
});
