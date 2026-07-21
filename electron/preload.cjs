const { contextBridge, ipcRenderer } = require("electron");

function sync(channel, ...args) {
  return ipcRenderer.sendSync(channel, ...args);
}

// SECURITY: set by the main process (via webPreferences.additionalArguments)
// ONLY on the internal PDF-export window, which main creates after verifying the
// caller's session + permission. The renderer cannot forge process.argv, so the
// print pages can trust this flag to skip their interactive auth guard.
const isInternalPrint = process.argv.includes("--hw-internal-print");

contextBridge.exposeInMainWorld("desktopAPI", {
  platform: "electron",
  isInternalPrint,
  license: {
    getMachineCode: () => ipcRenderer.invoke("license:get-machine-code"),
    getStatus: () => ipcRenderer.invoke("license:get-status"),
    activate: (serial) => ipcRenderer.invoke("license:activate", serial),
    onRevoked: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("license:revoked", handler);
      return () => ipcRenderer.removeListener("license:revoked", handler);
    },
    onRestored: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("license:restored", handler);
      return () => ipcRenderer.removeListener("license:restored", handler);
    },
  },
  setup: {
    createOwner: (username, password) =>
      ipcRenderer.invoke("setup:create-owner", { username, password }),
    hasOwner: () => ipcRenderer.invoke("setup:has-owner"),
    selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
  },
  auth: {
    login: (username, password) =>
      ipcRenderer.invoke("auth:login", { username, password }),
    logout: () => ipcRenderer.invoke("auth:logout"),
    hashPassword: (password) => ipcRenderer.invoke("auth:hash-password", password),
    changePassword: (userId, currentPassword, newPassword) =>
      ipcRenderer.invoke("auth:change-password", {
        userId,
        currentPassword,
        newPassword,
      }),
    updateProfile: (userId, name, currentPassword, newPassword) =>
      ipcRenderer.invoke("auth:update-profile", {
        userId,
        name,
        currentPassword,
        newPassword,
      }),
    resetOwnerPassword: (supportCode, username, password) =>
      ipcRenderer.invoke("support:reset-owner-password", {
        supportCode,
        username,
        password,
      }),
  },
  print: {
    route: (route) => ipcRenderer.invoke("print:route", route),
    savePdfRoute: (route) => ipcRenderer.invoke("print:save-pdf-route", route),
  },
  storage: {
    get: (key) => sync("storage:get", key),
    set: (key, value) => ipcRenderer.invoke("storage:set", key, value),
    remove: (key) => ipcRenderer.invoke("storage:remove", key),
    clearPrefix: (prefix) => ipcRenderer.invoke("storage:clear-prefix", prefix),
    export: () => ipcRenderer.invoke("storage:export"),
    import: (payload) => ipcRenderer.invoke("storage:import", payload),
    getBatch: () => ipcRenderer.invoke("storage:get-batch"),
    setBatch: (entries) => ipcRenderer.invoke("storage:set-batch", entries),
  },
  backup: {
    writeFile: (dir, fileName, content, passphrase) =>
      ipcRenderer.invoke("backup:write-file", { dir, fileName, content, passphrase }),
    selectDirectory: () => ipcRenderer.invoke("backup:select-directory"),
    encryptContent: (content, passphrase) =>
      ipcRenderer.invoke("backup:encrypt-content", content, passphrase),
    decryptContent: (content, passphrase) =>
      ipcRenderer.invoke("backup:decrypt-content", content, passphrase),
  },
  app: {
    // Main asks the renderer to take a backup right before the window closes.
    // Returns an unsubscribe function.
    onRunCloseBackup: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("app:run-close-backup", handler);
      return () => ipcRenderer.removeListener("app:run-close-backup", handler);
    },
    // Renderer signals it finished (or skipped) the close-time backup.
    closeBackupDone: () => ipcRenderer.send("app:close-backup-done"),
  },
});

// Prevent internal file:// paths from appearing in the browser status bar
// when the user hovers over navigation links. Temporarily replaces the full
// href with just the hash fragment (#/route) on mouseover, then restores it
// on mouseout. React Router navigates via onClick (pushState) so this is safe.
window.addEventListener("DOMContentLoaded", () => {
  function findAnchor(target) {
    let el = target;
    while (el && el.tagName !== "A") el = el.parentElement;
    return el || null;
  }

  document.addEventListener("mouseover", (e) => {
    const a = findAnchor(e.target);
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("file:")) return;
    const hashIdx = href.indexOf("#");
    const clean = hashIdx !== -1 ? href.slice(hashIdx) : "#";
    a._preloadSavedHref = href;
    a.setAttribute("href", clean);
  }, true);

  document.addEventListener("mouseout", (e) => {
    const a = findAnchor(e.target);
    if (!a || !a._preloadSavedHref) return;
    a.setAttribute("href", a._preloadSavedHref);
    delete a._preloadSavedHref;
  }, true);
}, { once: true });
