export function downloadRecoveryCodes(codes: string[], username: string): void {
  const safeUsername = username.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "account";
  const content = [
    "PartFlow — By Helpers Tech",
    `Recovery codes for: ${username}`,
    "Each code can be used once. Keep this file outside the application device.",
    "",
    ...codes.map((code, index) => `${index + 1}. ${code}`),
    "",
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `autoparts-recovery-codes-${safeUsername}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}
