# Security Policy

This is a proprietary desktop application maintained by Helpers Technologies.

## Supported versions

| Version | Supported |
| ------- | --------- |
| Latest  | ✅ Yes    |
| Older   | ❌ No — update to the latest release |

## Security model

| Layer | Implementation |
| ----- | -------------- |
| Database | SQLCipher encryption via `better-sqlite3-multiple-ciphers` |
| Passwords | Argon2id hashing — plain-text passwords are never stored |
| IPC bridge | Context isolation, sandboxed renderer, restricted preload API |
| Renderer | CSP headers, no `nodeIntegration`, no `remote` module |
| Packaging | ASAR integrity, Electron fuses (runAsNode disabled, etc.) |
| License | Machine-bound signed tokens, clock-tamper detection |
| Brute-force | Rate limiting on login and support-code entry |

## Files that must never be committed

| File / pattern | Reason |
| -------------- | ------ |
| `electron/license-public-key.cjs` | Production signing key — distribute via private channel only |
| `*.pfx`, `*.p12`, `*.pem`, `*.key` | Code-signing certificates and private keys |
| `*.cer` | Public certificate (distributed separately to clients) |
| `release/` | Built installers — not for source control |
| `.env`, `.env.local` | Environment secrets |
| Customer databases, backup files, license tokens | Client-specific data |

The repository includes `electron/license-public-key.example.cjs` as a safe placeholder.

## Reporting a vulnerability

Report security issues privately — do **not** open a public GitHub issue.

Contact Helpers Technologies directly:

| Channel | Details |
| ------- | ------- |
| WhatsApp | [+201118445625](https://wa.me/201118445625) |
| Website | [helpers-tech.com](https://helpers-tech.com) |

Please include:
- A clear description of the vulnerability
- Steps to reproduce
- Potential impact
- Your suggested fix (optional)

We aim to respond within **3 business days** and to release a fix within **14 days** for confirmed issues.
