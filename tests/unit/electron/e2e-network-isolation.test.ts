/**
 * Nothing leaves the machine while HW_E2E is set.
 *
 * HW_E2E marks a process that a test harness is driving against a synthetic
 * shop. Four of the outbound calls in main.cjs guarded on it from the start;
 * the two that actually PUBLISH the shop's contents did not. An E2E run
 * against a seeded five-year fixture therefore uploaded 48,483 fake orders and
 * 25,000 fake customers into the live portal, under the real licence the
 * fixture had been seeded with, replacing that customer's snapshot.
 *
 * Asserting the specific fix would only pin the instance. This reads the
 * source and requires the RULE — every function that calls the portal opens
 * with an HW_E2E bail-out — so the next outbound call added without one fails
 * here rather than in a customer's account.
 *
 * TC-E2EISO-001 through TC-E2EISO-003
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const mainPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../electron/main.cjs",
);
const source = readFileSync(mainPath, "utf8");

/** Splits main.cjs into `async function name() { … }` bodies by brace depth. */
function asyncFunctions(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const signature = /\basync function ([A-Za-z0-9_$]+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = signature.exec(text)) !== null) {
    // Walk past the parameter list before looking for the body. Taking the
    // first "{" after the name lands inside a destructured parameter —
    // `async function f({ force = false } = {})` — and yields a two-word
    // "body" that trivially satisfies any assertion made about it.
    let paren = 1;
    let cursor = signature.lastIndex; // just after the opening "("
    while (cursor < text.length && paren > 0) {
      const ch = text[cursor];
      if (ch === "(") paren += 1;
      else if (ch === ")") paren -= 1;
      cursor += 1;
    }
    const bodyStart = text.indexOf("{", cursor);
    if (bodyStart < 0) continue;
    let depth = 0;
    let end = bodyStart;
    for (let i = bodyStart; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out.set(match[1], text.slice(bodyStart, end + 1));
  }
  return out;
}

const FUNCTIONS = asyncFunctions(source);

/** Functions that reach the portal or the licence host over the network. */
const OUTBOUND = [...FUNCTIONS.entries()].filter(
  ([, body]) =>
    /\bfetch\s*\(/.test(body) &&
    /REFERRAL_PORTAL_ORIGIN|HEARTBEAT_BASE_URL/.test(body),
);

describe("E2E network isolation — TC-E2EISO", () => {
  it("TC-E2EISO-001: the source is parsed and outbound calls are actually found", () => {
    // Guards against the whole suite quietly passing because the regex stopped
    // matching after a refactor.
    expect(FUNCTIONS.size).toBeGreaterThan(20);
    expect(OUTBOUND.length).toBeGreaterThanOrEqual(4);
  });

  it("TC-E2EISO-002: every function that calls the portal bails out under HW_E2E", () => {
    const unguarded = OUTBOUND.filter(([, body]) => {
      // The bail-out must come before the request is built, so only the part
      // of the body preceding the first fetch counts.
      const beforeFetch = body.slice(0, body.search(/\bfetch\s*\(/));
      return !/if\s*\(\s*HW_E2E\b/.test(beforeFetch);
    }).map(([name]) => name);

    expect(
      unguarded,
      `these reach the network with no HW_E2E bail-out:\n  ${unguarded.join("\n  ")}\n` +
        "A test run must never write into a real customer's account.",
    ).toEqual([]);
  });

  it("TC-E2EISO-003: the two publishing calls are covered by name", () => {
    // Named explicitly because these are the ones that send shop CONTENTS
    // rather than a status ping, and they are the pair that was missed.
    for (const name of ["syncCommerceOnline", "syncCloudArchive"]) {
      const body = FUNCTIONS.get(name);
      expect(body, `${name} not found in main.cjs`).toBeDefined();
      const beforeFetch = body!.slice(0, body!.search(/\bfetch\s*\(/));
      expect(
        /if\s*\(\s*HW_E2E\b/.test(beforeFetch),
        `${name} must refuse to run under HW_E2E before it builds a request`,
      ).toBe(true);
    }
  });
});
