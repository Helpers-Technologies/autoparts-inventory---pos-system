const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function resolveReleaseFile(input) {
  const candidate = input
    ? path.resolve(rootDir, input)
    : path.join(
        releaseDir,
        `${packageJson.build.productName}-${packageJson.version}-Setup.exe`,
      );
  const relative = path.relative(releaseDir, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Update artifact must be inside the release directory");
  }
  if (path.extname(candidate).toLowerCase() !== ".exe") {
    throw new Error("The Windows update artifact must be an .exe installer");
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error(`Installer not found: ${candidate}`);
  }
  return candidate;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}

async function main() {
  const artifactPath = resolveReleaseFile(readArgument("--file"));
  const artifactUrl = readArgument("--url") || "";
  if (artifactUrl) {
    const parsed = new URL(artifactUrl);
    if (parsed.protocol !== "https:") {
      throw new Error("The published artifact URL must use HTTPS");
    }
  }

  const stat = fs.statSync(artifactPath);
  const metadata = {
    schemaVersion: 1,
    productSlug: "autoparts",
    version: packageJson.version,
    title: `PartFlow ${packageJson.version}`,
    notes: "",
    severity: "normal",
    artifactFile: path.basename(artifactPath),
    artifactUrl,
    artifactSize: stat.size,
    artifactSha512: await hashFile(artifactPath),
    generatedAt: new Date().toISOString(),
  };

  const defaultOutput = path.join(
    releaseDir,
    `PartFlow-${packageJson.version}-update.json`,
  );
  const outputPath = path.resolve(
    rootDir,
    readArgument("--output") || defaultOutput,
  );
  const outputRelative = path.relative(releaseDir, outputPath);
  if (outputRelative.startsWith("..") || path.isAbsolute(outputRelative)) {
    throw new Error("Metadata output must be inside the release directory");
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
