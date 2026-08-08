const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const winUnpackedDir = path.join(releaseDir, "win-unpacked");
const unpackedExePath = path.join(winUnpackedDir, "PartFlow.exe"); // must match package.json build.productName

function assertInsideRelease(targetPath) {
  const resolvedRelease = path.resolve(releaseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRelease, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean outside release directory: ${resolvedTarget}`);
  }
}

function stopRunningUnpackedApp() {
  if (process.platform !== "win32" || !fs.existsSync(unpackedExePath)) return;

  const script = `
$resolvedTarget = [System.IO.Path]::GetFullPath($env:HELPERS_UNPACKED_EXE)
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $resolvedTarget)
}
foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  Write-Output "Stopped locked unpacked app process $($process.ProcessId)"
}
`;

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        HELPERS_UNPACKED_EXE: unpackedExePath,
      },
    }
  );

  if (result.stdout.trim()) process.stdout.write(`${result.stdout.trim()}\n`);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Failed to stop previous unpacked app process.\n");
    process.exit(result.status || 1);
  }
}

function cleanWinUnpacked() {
  if (!fs.existsSync(winUnpackedDir)) return;
  assertInsideRelease(winUnpackedDir);

  try {
    fs.rmSync(winUnpackedDir, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 500,
    });
    process.stdout.write("Cleaned release/win-unpacked before packaging.\n");
  } catch (error) {
    if (error && error.code === "EBUSY") {
      process.stderr.write(
        "release/win-unpacked is still locked. Close any running packaged app or Explorer preview window and run npm run dist:win again.\n"
      );
    }
    throw error;
  }
}

stopRunningUnpackedApp();
cleanWinUnpacked();
