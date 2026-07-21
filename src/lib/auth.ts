export async function hashPassword(password: string): Promise<string> {
  if (window.desktopAPI?.auth) {
    return window.desktopAPI.auth.hashPassword(password);
  }

  const encoded = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hash}`;
}

export async function verifyFallbackPassword(
  storedHash: string,
  password: string
): Promise<boolean> {
  if (storedHash.startsWith("sha256:")) {
    return (await hashPassword(password)) === storedHash;
  }
  // Legacy btoa path: unsupported — caller should reset the password
  return false;
}
