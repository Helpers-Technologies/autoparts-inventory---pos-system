/**
 * Every action a shop cannot undo must sit behind a confirmation.
 *
 * The dialogs themselves are covered by ConfirmDialogContract.test.tsx and the
 * store effects by system-probe / money-stock-defects. What neither can see is
 * the wiring: nothing stopped someone adding a "حذف" button whose onClick calls
 * deleteSalesInvoice directly, with no dialog in between. That mistake would
 * pass every existing test and destroy a customer's records on one stray click.
 *
 * This walks the real TypeScript AST of every page and feature component,
 * finds each call to a destructive store action, and requires that it be
 * reachable only through a dialog — either inside a <ConfirmDialog onConfirm>,
 * or inside the JSX of a <Dialog>/<*Dialog> that the user must open first, or
 * inside a named handler that one of those references.
 *
 * It is deliberately a whitelist of *actions*, not of files: adding a new page
 * that deletes invoices is covered the day it is written, without anyone
 * remembering to update a test.
 *
 * TC-GUARD-001 through TC-GUARD-004
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type * as TS from "typescript";

const require = createRequire(import.meta.url);
const ts: typeof TS = require("typescript");

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src",
);

/**
 * Store actions that move money or stock, or destroy a record, in a way the
 * shop cannot walk back from the UI. Read/derive helpers are not here; neither
 * are the `add*` creators, which are undoable by deleting what they created.
 */
const DESTRUCTIVE = new Set([
  "deleteSalesInvoice",
  "cancelSalesInvoice",
  "deletePurchaseInvoice",
  "deleteQuotation",
  "deleteProduct",
  "deleteCustomer",
  "deleteSupplier",
  "deleteDriver",
  "deleteUser",
  "deleteStocktake",
  "deleteCommissionTier",
  "applyStocktake",
  "restoreDeletedInvoice",
  "settleAllDues",
  "settleSupplierDues",
  "resetDemo",
]);

/** A call inside one of these JSX elements has a dialog in front of it. */
const DIALOG_TAG = /(^|[A-Za-z])(Dialog|Modal)$/;

function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, found);
    else if (entry.endsWith(".tsx")) found.push(full);
  }
  return found;
}

function jsxTagName(node: TS.Node): string | null {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return null;
}

interface Finding {
  file: string;
  line: number;
  action: string;
  gate: string;
}

/**
 * Classifies one destructive call site: which gate, if any, stands in front of
 * it. Returns null when nothing does.
 */
function gateFor(
  call: TS.Node,
  source: TS.SourceFile,
  confirmHandlerNames: Set<string>,
): string | null {
  for (let node: TS.Node | undefined = call; node; node = node.parent) {
    // Inside <ConfirmDialog onConfirm={...}> — the strongest gate.
    if (ts.isJsxAttribute(node) && node.name.getText() === "onConfirm") {
      return "onConfirm";
    }
    // Inside the markup of a dialog the user had to open.
    const tag = jsxTagName(node);
    if (tag && DIALOG_TAG.test(tag)) return `<${tag}>`;
    // A named handler that some onConfirm={handler} points at.
    if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      confirmHandlerNames.has(node.name.text)
    ) {
      return `handler ${node.name.text}()`;
    }
  }
  return null;
}

/** Names passed by reference to an onConfirm attribute anywhere in the file. */
function collectConfirmHandlers(source: TS.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: TS.Node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText() === "onConfirm" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isIdentifier(node.initializer.expression)
    ) {
      names.add(node.initializer.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function auditFile(file: string) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const confirmHandlers = collectConfirmHandlers(source);
  const gated: Finding[] = [];
  const ungated: Finding[] = [];

  const visit = (node: TS.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name && DESTRUCTIVE.has(name)) {
        const line =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const gate = gateFor(node, source, confirmHandlers);
        const finding: Finding = {
          file: path.relative(SRC, file).replace(/\\/g, "/"),
          line,
          action: name,
          gate: gate ?? "NONE",
        };
        (gate ? gated : ungated).push(finding);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { gated, ungated };
}

const files = tsxFiles(SRC);
const results = files.map(auditFile);
const allGated = results.flatMap((r) => r.gated);
const allUngated = results.flatMap((r) => r.ungated);

describe("destructive actions are reachable only through a confirmation — TC-GUARD", () => {
  it("TC-GUARD-001: the audit actually found call sites to judge", () => {
    // Without this the suite would pass vacuously if the AST walk broke, the
    // src layout moved, or every action got renamed.
    expect(files.length).toBeGreaterThan(50);
    expect(allGated.length + allUngated.length).toBeGreaterThanOrEqual(20);
  });

  it("TC-GUARD-002: no destructive action is wired without a dialog in front of it", () => {
    const report = allUngated
      .map((f) => `  ${f.file}:${f.line} calls ${f.action}() with no confirmation`)
      .join("\n");
    expect(
      allUngated,
      `these would destroy records on a single click:\n${report}\n\n` +
        "Wire the call through <ConfirmDialog onConfirm={...}>, or place it " +
        "inside a <Dialog> the user must open first.",
    ).toEqual([]);
  });

  it("TC-GUARD-003: the most dangerous actions are each guarded somewhere", () => {
    // Presence, not just absence: if a whole feature were deleted or renamed
    // this test notices, where TC-GUARD-002 would just go quiet.
    const guarded = new Set(allGated.map((f) => f.action));
    for (const action of [
      "deleteSalesInvoice",
      "deletePurchaseInvoice",
      "applyStocktake",
      "restoreDeletedInvoice",
      "settleAllDues",
      "deleteProduct",
    ]) {
      expect(guarded.has(action), `${action}() has no guarded call site`).toBe(true);
    }
  });

  it("TC-GUARD-004: every guard is a real dialog, not an ad-hoc gate", () => {
    for (const finding of allGated) {
      expect(
        finding.gate === "onConfirm" ||
          finding.gate.startsWith("<") ||
          finding.gate.startsWith("handler "),
        `${finding.file}:${finding.line} — unexpected gate "${finding.gate}"`,
      ).toBe(true);
    }
  });
});
