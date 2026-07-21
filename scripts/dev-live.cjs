#!/usr/bin/env node
/**
 * dev-live — keeps the running app in sync with code AND with GitHub, both ways,
 * with zero rebuilds:
 *
 *   • Vite dev server   → renderer (src/**) changes hot-reload instantly (HMR).
 *   • electron/** watch  → main-process changes auto-restart Electron only.
 *   • AUTO-PUSH (out)    → a few seconds after you stop editing, it commits all
 *                          changes and pushes to GitHub so your friend gets them.
 *   • AUTO-PULL (in)     → every 60s (and before each push) it pulls new GitHub
 *                          commits with --rebase. Pulled renderer files HMR;
 *                          pulled electron/** files restart Electron.
 *
 * On any git conflict/auth failure it PAUSES auto-sync and prints a clear note
 * instead of making a mess. Run: npm run dev:live   Stop: Ctrl+C.
 */
const { spawn, exec, execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..");
const VITE_URL = "http://127.0.0.1:5173";
const GIT_POLL_MS = 60_000;       // inbound check cadence
const COMMIT_DEBOUNCE_MS = 12_000; // commit this long after the last edit
const isWin = process.platform === "win32";
const SRC_EXT = /\.(tsx?|jsx?|c?js|css|json|html|svg)$/i;

let viteProc = null;
let electronProc = null;
let restartingElectron = false;
let shuttingDown = false;
let syncPaused = false;
let syncing = false;
let commitTimer = null;
let elecTimer = null;

const log = (m) => console.log(`\x1b[36m[dev-live]\x1b[0m ${m}`);

/* ───────────────────────── processes ───────────────────────── */
function startVite() {
  const bin = path.join(ROOT, "node_modules", ".bin", isWin ? "vite.cmd" : "vite");
  viteProc = spawn(bin, ["--host", "127.0.0.1", "--strictPort"], { cwd: ROOT, stdio: "inherit", shell: isWin });
  viteProc.on("exit", (code) => { if (!shuttingDown) { log(`Vite exited (${code}) — shutting down.`); shutdown(); } });
}

function waitForVite(cb, tries = 0) {
  http.get(VITE_URL, () => cb()).on("error", () => {
    if (tries > 120) return log("Vite did not become ready in time.");
    setTimeout(() => waitForVite(cb, tries + 1), 500);
  });
}

function startElectron() {
  const electronBin = require("electron");
  const env = { ...process.env, ELECTRON_RENDERER_URL: VITE_URL };
  delete env.ELECTRON_RUN_AS_NODE;
  electronProc = spawn(electronBin, ["."], { cwd: ROOT, stdio: "inherit", env, shell: false });
  electronProc.on("exit", () => {
    electronProc = null;
    if (restartingElectron) { restartingElectron = false; setTimeout(() => { if (!shuttingDown) startElectron(); }, 900); }
    else if (!shuttingDown) { log("Electron window closed — shutting down."); shutdown(); }
  });
}

function restartElectron() {
  if (restartingElectron) return;
  if (!electronProc) { startElectron(); return; }
  restartingElectron = true;
  log("main-process change → restarting Electron…");
  try {
    if (isWin) execSync(`taskkill /pid ${electronProc.pid} /T /F`, { stdio: "ignore" });
    else electronProc.kill("SIGTERM");
  } catch { /* exit handler respawns */ }
}

/* ───────────────────────── git sync ───────────────────────── */
function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ err, out: String(stdout || "").trim(), errOut: String(stderr || "").trim() }));
  });
}

async function syncGit() {
  if (syncPaused || syncing || shuttingDown) return;
  syncing = true;
  try {
    // 1) commit local changes (if any)
    const status = await run("git status --porcelain");
    if (status.out) {
      await run("git add -A");
      const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
      const c = await run(`git commit -m "auto: live changes ${ts}"`);
      if (!c.err) log(`committed local changes (${ts})`);
    }
    // 2) integrate remote
    await run("git fetch --quiet");
    const behind = parseInt((await run("git rev-list --count HEAD..@{u}")).out || "0", 10) || 0;
    if (behind > 0) {
      const p = await run("git pull --rebase");
      if (p.err) { syncPaused = true; return log(`git pull failed — auto-sync PAUSED. Resolve manually + restart dev:live.\n${p.errOut || p.out}`); }
      log(`pulled ${behind} commit(s) from GitHub`);
    }
    // 3) push local commits
    const ahead = parseInt((await run("git rev-list --count @{u}..HEAD")).out || "0", 10) || 0;
    if (ahead > 0) {
      const pu = await run("git push");
      if (pu.err) { syncPaused = true; return log(`git push failed — auto-sync PAUSED.\n${pu.errOut || pu.out}`); }
      log(`pushed ${ahead} commit(s) → friend can pull now`);
    }
  } finally {
    syncing = false;
  }
}

/* ───────────────────────── watchers ───────────────────────── */
function watchDir(rel, onChange) {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) return;
  try { fs.watch(dir, { recursive: true }, (_e, f) => { if (f) onChange(path.join(rel, String(f))); }); log(`watching ${rel}/**`); }
  catch (e) { log(`watch ${rel} failed: ${e.message}`); }
}

function handleChange(rel) {
  const f = rel.replace(/\\/g, "/");
  if (!SRC_EXT.test(f)) return;
  if (f.startsWith("electron/")) { clearTimeout(elecTimer); elecTimer = setTimeout(() => restartElectron(), 600); }
  clearTimeout(commitTimer);
  commitTimer = setTimeout(syncGit, COMMIT_DEBOUNCE_MS);
}

function watchRootFiles() {
  try {
    fs.watch(ROOT, { recursive: false }, (_e, f) => {
      if (f && /^(package\.json|\.hintrc|vite\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?js|tsconfig.*\.json)$/.test(String(f))) handleChange(String(f));
    });
  } catch { /* non-fatal */ }
}

/* ───────────────────────── lifecycle ───────────────────────── */
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down…");
  try { if (electronProc?.pid) { if (isWin) execSync(`taskkill /pid ${electronProc.pid} /T /F`, { stdio: "ignore" }); else electronProc.kill("SIGTERM"); } } catch {}
  try { if (viteProc?.pid) { if (isWin) execSync(`taskkill /pid ${viteProc.pid} /T /F`, { stdio: "ignore" }); else viteProc.kill("SIGTERM"); } } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log("starting Vite…");
startVite();
waitForVite(() => {
  log("Vite ready → launching Electron");
  startElectron();
  watchDir("src", handleChange);
  watchDir("electron", handleChange);
  watchDir("scripts", handleChange);
  watchDir("public", handleChange);
  watchRootFiles();
  setInterval(syncGit, GIT_POLL_MS);
  log(`auto-push ${COMMIT_DEBOUNCE_MS / 1000}s after edits • auto-pull every ${GIT_POLL_MS / 1000}s`);
});
