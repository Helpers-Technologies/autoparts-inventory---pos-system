/**
 * The printed invoice and the screen must name a payment method the same way.
 *
 * The main process builds print documents itself and carries its OWN copy of
 * the payment-method labels, because it cannot import from src/. That copy
 * drifted: after the renderer renamed the wallet bucket to "محفظة إلكترونية"
 * and added a "card" entry, main.cjs still said "فودافون كاش", had no "card"
 * key at all — so a Visa sale printed the raw English word "card" on the
 * customer's invoice — and said "رصيد دائن" where the screen said "رصيد".
 *
 * A printed document is what the customer keeps. It cannot disagree with the
 * screen it was printed from, so the two tables are pinned to each other here.
 *
 * TC-PAYLABEL-001 through TC-PAYLABEL-003
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PAYMENT_METHOD_LABELS, CASH_PAYMENT_METHODS } from "../../../src/lib/format";

const mainPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../electron/main.cjs",
);
const mainSource = readFileSync(mainPath, "utf8");

/** Pulls the main process's own label table out of its source. */
function mainProcessLabels(): Record<string, string> {
  const block = /const paymentMethodLabels = \{([\s\S]*?)\};/.exec(mainSource);
  if (!block) throw new Error("paymentMethodLabels not found in electron/main.cjs");
  const labels: Record<string, string> = {};
  for (const entry of block[1].matchAll(/(\w+):\s*"([^"]+)"/g)) {
    labels[entry[1]] = entry[2];
  }
  return labels;
}

describe("payment-method label parity — TC-PAYLABEL", () => {
  it("TC-PAYLABEL-001: the main process table is found and is not empty", () => {
    // Guards against this whole suite passing vacuously because the constant
    // was renamed or moved and the regex stopped matching.
    const labels = mainProcessLabels();
    expect(Object.keys(labels).length).toBeGreaterThanOrEqual(6);
  });

  it("TC-PAYLABEL-002: every method the shop can take money by is named identically in both", () => {
    const printed = mainProcessLabels();
    const mismatched: string[] = [];
    for (const method of CASH_PAYMENT_METHODS) {
      const onScreen = PAYMENT_METHOD_LABELS[method];
      if (printed[method] !== onScreen) {
        mismatched.push(`${method}: screen="${onScreen}" printed="${printed[method] ?? "MISSING"}"`);
      }
    }
    expect(
      mismatched,
      `the printed invoice and the screen disagree:\n  ${mismatched.join("\n  ")}`,
    ).toEqual([]);
  });

  it("TC-PAYLABEL-003: no label is left as a raw English key", () => {
    // "card" was absent from the main-process table, so getPaymentLabel fell
    // through to `entry.paymentMethod` and printed the literal word.
    const printed = mainProcessLabels();
    for (const [method, label] of Object.entries(printed)) {
      expect(/^[a-z]+$/.test(label), `${method} prints as the raw key "${label}"`).toBe(false);
    }
    for (const method of CASH_PAYMENT_METHODS) {
      expect(printed[method], `no printed label for "${method}"`).toBeTruthy();
    }
  });
});
