const childProcess = require("node:child_process");
const electronPath = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronArgs = process.argv.slice(2);

// This launcher is used by `electron:dev` only. Linux refuses to start
// Chromium's SUID sandbox when the project lives on a `nosuid` filesystem
// (for example an NTFS development drive mounted under /run/media).
// Packaged builds and dev runs maintain Chromium sandbox.

const child = childProcess.spawn(electronPath, electronArgs, {
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
