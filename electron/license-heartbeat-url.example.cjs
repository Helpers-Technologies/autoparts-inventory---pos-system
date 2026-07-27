// SETUP (once per clone / machine, optional):
//   1. Copy this file to `license-heartbeat-url.cjs` in the same folder.
//   2. Replace LICENSE_HEARTBEAT_URL with your license portal's public
//      heartbeat base URL, e.g. "https://license.helpers-tech.com/api/public/heartbeat".
//
// Not a secret — this URL is called by every customer install and has to be
// publicly reachable anyway. Baked into a file (like license-public-key.cjs)
// rather than read from process.env at runtime for the same reason: an env
// var set during the CI build step has no effect on what ships inside the
// packaged app.asar that actually runs on a customer's machine.
//
// Leaving this null is safe — it just disables remote block/unblock and the
// app behaves exactly as before (offline signature-only validation).
const LICENSE_HEARTBEAT_URL =
  process.env.AUTOPARTS_LICENSE_HEARTBEAT_URL || null;

Object.freeze((module.exports = { LICENSE_HEARTBEAT_URL }));
