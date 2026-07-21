// SECURITY: Public key is hardcoded — never allow ENV override.
//
// SETUP (once per clone / machine):
//   1. Copy this file to `license-public-key.cjs` in the same folder.
//   2. Replace LICENSE_PUBLIC_KEY below with your real Ed25519 public PEM
//      (from your internal license tooling — never commit that file).
//
// The PEM below is a throwaway keypair for structure only; it will NOT
// verify production license serials until you paste the correct public key.

const LICENSE_PUBLIC_KEY =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxuWF+MlNOlUj6KMjBW/ECD7Uik7Rysm0ftIzGXyljEM=\n-----END PUBLIC KEY-----\n";

Object.freeze(module.exports = { LICENSE_PUBLIC_KEY });
