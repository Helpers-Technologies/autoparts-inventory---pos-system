// Writes electron/license-public-key.cjs with the real production public key
// from the AUTOPARTS_LICENSE_PUBLIC_KEY env var (a CI secret — see
// .github/workflows/release-exe.yml). Node's own string handling avoids the
// escaping pitfalls of building this file via shell/PowerShell string ops.
//
// The key is a public key: safe to bake into every shipped binary (that's
// its whole purpose), just never committed to source control directly.

const { writeFileSync } = require("node:fs");
const path = require("node:path");

const key = process.env.AUTOPARTS_LICENSE_PUBLIC_KEY;
if (!key || !key.includes("BEGIN PUBLIC KEY")) {
  throw new Error("AUTOPARTS_LICENSE_PUBLIC_KEY is missing or doesn't look like a PEM public key");
}

const content = `const LICENSE_PUBLIC_KEY =
  process.env.AUTOPARTS_LICENSE_PUBLIC_KEY ||
  ${JSON.stringify(key)};

module.exports = { LICENSE_PUBLIC_KEY };
`;

const target = path.join(__dirname, "..", "electron", "license-public-key.cjs");
writeFileSync(target, content, "utf8");
console.log(`Wrote ${target}`);
