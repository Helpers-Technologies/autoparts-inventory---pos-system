const { contextBridge, ipcRenderer } = require("electron");

const api = {
  printNow: () => ipcRenderer.invoke("print:current-window"),
  savePdf: () => ipcRenderer.invoke("print:save-current-pdf"),
  closeWindow: () => ipcRenderer.invoke("print:close-current-window"),
};

contextBridge.exposeInMainWorld("invoicePrint", {
  printNow: api.printNow,
  savePdf: api.savePdf,
  closeWindow: api.closeWindow,
});

function setStatus(message) {
  const statusEl = document.getElementById("print-status");
  if (statusEl) statusEl.textContent = message || "";
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = Boolean(busy);
  button.style.opacity = busy ? "0.72" : "";
  button.style.cursor = busy ? "wait" : "pointer";
}

async function printNow() {
  const button = document.getElementById("print-now-button");
  setBusy(button, true);
  setStatus("جاري تجهيز الطباعة...");
  try {
    const result = await api.printNow();
    setStatus(result && result.ok ? "تمت الطباعة" : "تعذرت الطباعة");
  } catch {
    setStatus("تعذرت الطباعة");
  } finally {
    setBusy(button, false);
  }
}

async function savePdf() {
  const button = document.getElementById("save-pdf-button");
  setBusy(button, true);
  setStatus("جاري حفظ PDF...");
  try {
    const result = await api.savePdf();
    setStatus(result && result.ok ? "تم حفظ PDF" : "لم يتم حفظ PDF");
  } catch {
    setStatus("تعذر حفظ PDF");
  } finally {
    setBusy(button, false);
  }
}

async function closeWindow() {
  try {
    await api.closeWindow();
  } catch {
    setStatus("تعذر إغلاق النافذة");
  }
}

function attachToolbarHandlers() {
  document.getElementById("print-now-button")?.addEventListener("click", printNow);
  document.getElementById("save-pdf-button")?.addEventListener("click", savePdf);
  document.getElementById("close-window-button")?.addEventListener("click", closeWindow);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", attachToolbarHandlers, { once: true });
} else {
  attachToolbarHandlers();
}
