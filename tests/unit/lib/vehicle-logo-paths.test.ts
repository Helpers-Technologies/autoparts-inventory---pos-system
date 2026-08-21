/**
 * Brand logo paths must be resolvable by the desktop build.
 *
 * The seeded catalogue stores every logo as "/vehicle-logos/<slug>.png". The
 * packaged app is loaded over file://, where a leading slash means the ROOT OF
 * THE DRIVE rather than the app folder, so all 352 logos failed to load and
 * every screen listing makes fell back to a generic car icon. A performance
 * sweep surfaced it only as 24 anonymous ERR_FILE_NOT_FOUND console errors.
 *
 * TC-LOGO-001 through TC-LOGO-004
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normaliseLogoPath } from "../../../src/store/VehicleCatalogContext";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const catalogue = JSON.parse(
  readFileSync(path.join(root, "src/data/vehicle-catalog.generated.json"), "utf8"),
) as { makes?: Array<{ name: string; slug?: string; logoPath?: string }> };

const SOURCE_FILES = [
  "src/features/products/ProductForm.tsx",
  "src/features/vehicles/CustomerVehicleFormDialog.tsx",
  "src/pages/PartsFinderPage.tsx",
  "src/pages/POSPage.tsx",
];

describe("vehicle logo paths — TC-LOGO", () => {
  it("TC-LOGO-001: no source file builds an absolute /vehicle-logos path", () => {
    const offenders = SOURCE_FILES.filter((file) =>
      /["`]\/vehicle-logos\//.test(readFileSync(path.join(root, file), "utf8")),
    );
    expect(
      offenders,
      `absolute asset paths do not resolve under file://:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("TC-LOGO-002: no source file builds any absolute asset path", () => {
    // The rule, not just the instance: any "/dir/file.png" literal breaks the
    // same way the logos did.
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const text = readFileSync(path.join(root, file), "utf8");
      const hits = text.match(/["`]\/[a-z0-9_-]+\/[^"`]*\.(png|jpg|jpeg|svg|webp|ico)/gi);
      if (hits) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("TC-LOGO-003: the catalogue really does carry absolute paths", () => {
    // Pins WHY the runtime normalisation exists. If a future catalogue ships
    // relative paths this fails, and the normaliser can then be retired
    // deliberately rather than left in place as cargo.
    const makes = catalogue.makes ?? [];
    expect(makes.length).toBeGreaterThan(100);
    const absolute = makes.filter((make) => make.logoPath?.startsWith("/"));
    expect(absolute.length).toBeGreaterThan(0);
  });

  it("TC-LOGO-004: the rewrite is wired into the path makes load through", () => {
    const source = readFileSync(
      path.join(root, "src/store/VehicleCatalogContext.tsx"),
      "utf8",
    );
    expect(source).toMatch(/enrichMakeCountry[\s\S]{0,400}normaliseLogoPath/);
  });

  it("TC-LOGO-005: an absolute path becomes relative, and nothing else is touched", () => {
    const make = (logoPath?: string) =>
      ({ id: "m", name: "Test", logoPath }) as Parameters<typeof normaliseLogoPath>[0];

    expect(normaliseLogoPath(make("/vehicle-logos/bmw.png")).logoPath)
      .toBe("./vehicle-logos/bmw.png");

    // A logo the shop uploaded itself is a data URL — rewriting it would
    // destroy it.
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    expect(normaliseLogoPath(make(dataUrl)).logoPath).toBe(dataUrl);

    // Already relative, or absent: returned untouched, same object.
    const relative = make("./vehicle-logos/bmw.png");
    expect(normaliseLogoPath(relative)).toBe(relative);
    const none = make(undefined);
    expect(normaliseLogoPath(none)).toBe(none);
  });

  it("TC-LOGO-006: every seeded make ends up with a loadable path", () => {
    const makes = catalogue.makes ?? [];
    const bad = makes
      .map((m) => normaliseLogoPath(m as Parameters<typeof normaliseLogoPath>[0]))
      .filter((m) => m.logoPath && m.logoPath.startsWith("/"));
    expect(bad.length, `${bad.length} of ${makes.length} still absolute`).toBe(0);
  });
});
