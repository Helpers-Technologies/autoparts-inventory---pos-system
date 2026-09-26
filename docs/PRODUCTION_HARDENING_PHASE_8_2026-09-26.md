# Production hardening — Phase 8 release candidate

**Date:** 2026-09-26
**Candidate:** PartFlow 10.5.1
**Source commit:** `bd6db8eb3964a41365f890400eabd2e84f966ea9`
**Result:** FAIL — do not release to production yet

The release candidate itself builds, starts, activates, upgrades the historical data fixture, completes a real sale, survives restart, restores the pre-upgrade database, and enforces denied employee mutations. The phase cannot pass because the required clean NSIS installation and in-place upgrade were not run, and the signing certificate is self-signed rather than publicly trusted.

## Objective and audit scope

Phase 8 prepared and exercised a production-like Windows candidate after Phases 0–7 passed. It covers the official build, installer artifact, signing configuration, fresh profile activation, historical database migration, backup and restore, employee permissions, multi-branch durability, and a representative packaged workflow.

No product architecture changed in this phase. `package.json` and `package-lock.json` were advanced from 10.5.0 to 10.5.1 so the candidate does not collide with the previously installed 10.5.0 release. All execution used isolated profiles or copied audit databases; `C:\Program Files\PartFlow\PartFlow.exe` version 10.5.0 was not modified.

## Release gate matrix

| Subsystem | Status | Evidence |
|---|---|---|
| Official Windows build | PASS | `npm run dist:win` produced the packaged app, NSIS installer, and block map from commit `bd6db8e` |
| Installer artifact creation | PASS | `PartFlow-10.5.1-Setup.exe`, 108,219,296 bytes |
| Installer execution on a clean machine | NOT VERIFIED | Windows Sandbox is unavailable and this machine already has PartFlow 10.5.0 under `C:\Program Files`; the live installation was deliberately protected |
| In-place NSIS upgrade from 10.5.0 | NOT VERIFIED | no disposable Windows installation was available; the production-like data upgrade was verified separately |
| Signing mechanism and timestamp | PASS | installer and packaged executable report valid Authenticode locally, expected thumbprint, and DigiCert timestamp |
| Publicly trusted production signing identity | FAIL | signer is `Helpers Technologies Self-Signed Code Signing`; customer trust on a clean machine is not established |
| ASAR integrity | PASS | expected and actual SHA-256 both `8D54496AAA00A622EB90116398595208827AF5A6A3F31C45236A3664B41CC5C8` |
| Update metadata generation | PASS | version, filename, size, and SHA-512 match the installer |
| Published update/download path | NOT VERIFIED | candidate metadata has no production HTTPS artifact URL and nothing was published |
| Fresh packaged profile | PASS | packaged 10.5.1 opened with a new isolated `userData` profile |
| License activation | PASS | a real signed, machine-bound test license moved the packaged app from activation to first-run setup |
| Full first-run wizard via installed NSIS app | NOT VERIFIED | fresh packaged entry was verified; native folder selection and installed-app completion were not run on a disposable machine |
| Historical database migration | PASS | 10.5.1 opened a copied older encrypted fixture, passed SQLite integrity, and completed the representative routes/workflow |
| Backup before upgrade | PASS | source, working copy, and pre-upgrade copy all started with SHA-256 `A55287B046CB83C76071F18D78AA24F5C87A3FFCC8C187C6DD8FBD2AB1ECFB28` |
| Restore into a separate profile | PASS | restored database opened under 10.5.1 with active license and matched the pre-upgrade business collections |
| Employee permissions | PASS | denied employee authenticated, while product writes, prefix clearing, and sale commit were rejected |
| Multi-branch state | PASS | sale/restart comparison preserved branch-stock semantics; restored all 2,068 historical branch-stock rows unchanged and added only catalog bootstrap rows |
| Representative real workflow | PASS | packaged login, dashboard, dues, branches, POS, real sale, graceful close, restart, and durable comparison passed |
| Build/type/lint/tests | PASS | build and both type checks passed; ESLint had 0 errors and 21 existing warnings; 92 files and 1,240 tests passed |
| Production deployment | NOT VERIFIED | no installer or update was published or deployed |

## Official artifact and integrity evidence

The signed artifact is retained in the isolated release worktree:

```text
D:\Helpers_Tech\win-app\Autoparts-inventory-system\.partflow-rc-phase8\release\PartFlow-10.5.1-Setup.exe
```

| Property | Value |
|---|---|
| Installer SHA-256 | `2DBBDCF4069B48AE42651675B0E898E47CB13E86AEEDE1509D2A4722B0A77BAF` |
| Installer SHA-512 | `95C57C77886FB0841664457AE49C5877E7980361E97FC3660C6E004A07B62D84E240CAF7373CF6FFA436371E86DA9245C3DD183B852B118BD21F3E018A5776E2` |
| Authenticode status | `Valid` on the build machine |
| Certificate thumbprint | `E950B2D3C22831B0EDE52E0F69D7C0C422BCBE02` |
| Timestamp authority | DigiCert SHA256 RSA4096 Timestamp Responder 2026 1 |
| ASAR SHA-256 | `8D54496AAA00A622EB90116398595208827AF5A6A3F31C45236A3664B41CC5C8` |

The SHA-512 in `PartFlow-10.5.1-update.json` was generated from the completed signed installer. The metadata size is 108,219,296 bytes, matching the artifact.

## Fresh activation

The packaged executable was launched against an empty isolated profile. The activation screen accepted a newly generated signed test license bound to this machine and displayed first-run step 1. The activation token and private licensing material remain outside Git and are not included in this report.

This proves the packaged public key, signature verification, machine fingerprint, license storage, and transition into initial setup. It does not replace a complete NSIS installation test on a clean machine.

## Historical database and representative workflow

The Small historical audit database was copied before launch. A test license was inserted into the isolated copy using the same machine-derived SQLCipher key as the application. The official packaged 10.5.1 executable then performed:

1. owner login through the real login UI;
2. navigation to `/`, `/dues`, `/branches`, and `/pos`;
3. a real POS sale through the UI;
4. graceful application close;
5. restart and owner login;
6. semantic comparison of products, customers, invoices, cash, movements, branch stocks, shifts, delivery orders, and quotations;
7. denied-employee authentication and negative IPC mutation checks.

The sale completed in 1,681 ms. Sales invoices changed from 4,993 to 4,994, with exactly one cash entry and one stock movement added and product/branch quantity reduced by one. The post-restart business snapshots matched the post-sale snapshots. Login added an expected audit event, so audit logs were checked for monotonic growth rather than byte identity.

## Backup and restore verification

The untouched pre-upgrade database was copied into another isolated profile and opened by packaged 10.5.1. SQLite `integrity_check` returned `ok`.

The application applied its existing idempotent starter-catalog migration:

| Collection | Before | After | Old rows missing | Old rows semantically changed |
|---|---:|---:|---:|---:|
| Products | 1,000 | 1,115 | 0 | 0 |
| Branch stocks | 2,068 | 2,127 | 0 | 0 |

The 115 product and 59 branch-stock additions belong to the starter catalog. Legacy product normalization added defaults such as an empty `oemNumbers` array where absent; comparison applied the same migration contract before checking equality. Customers, invoices, cash entries, stock movements, and shifts matched their pre-upgrade semantic hashes and totals.

Phase 7 separately verified the full application archive pipeline on the Large fixture: 261.7 MiB plaintext, 40.5 MiB encrypted envelope, and byte-identical restore, including invalid-password and corruption rejection.

## Commands and results

```text
npm run dist:win
node scripts/generate-update-metadata.cjs
Get-AuthenticodeSignature release/PartFlow-10.5.1-Setup.exe
Get-AuthenticodeSignature release/win-unpacked/PartFlow.exe
Get-FileHash -Algorithm SHA256 release/PartFlow-10.5.1-Setup.exe
Get-FileHash -Algorithm SHA256 release/win-unpacked/resources/app.asar
npm rebuild better-sqlite3-multiple-ciphers argon2
npm run build
npm run lint
npm run typecheck:tests
npm test -- --reporter=dot
```

Results:

- production build: PASS;
- test TypeScript: PASS;
- ESLint: PASS with 0 errors and 21 warnings;
- Node native-module load after rebuild: PASS;
- Vitest: 92/92 files and 1,240/1,240 tests passed in 172.53 seconds;
- packaged historical workflow and restart: PASS;
- restored historical database and semantic row preservation: PASS.

Machine-readable evidence is under `reports/production-hardening-2026-09/phase-8/`, including `release-verification.json` and the isolated historical run directory. Release artifacts and generated test licenses are ignored by Git.

## Files and commits

Phase 8 release changes:

- `package.json` — version 10.5.1;
- `package-lock.json` — version 10.5.1;
- `docs/PRODUCTION_HARDENING_PHASE_8_2026-09-26.md` — this release-readiness report.

Relevant commit:

- `bd6db8e` — `chore(release): prepare 10.5.1 candidate`.

No migration code was added. The tested catalog/default normalization was existing behavior and was verified against the historical fixture.

## Remaining risks and required closure

1. Obtain a publicly trusted code-signing certificate, rebuild, and verify SmartScreen/signature trust on a clean Windows machine.
2. Run the NSIS installer on a clean supported Windows environment, complete first-run setup, activate, restart, and uninstall.
3. In a disposable Windows environment, install 10.5.0, load representative data, run the 10.5.1 installer over it, and repeat the durable comparisons.
4. Publish the installer and update metadata to a staging HTTPS endpoint, then verify check, download, SHA-512 validation, install, and rollback behavior.

## Recommendation

**FAIL — do not proceed to production deployment.**

The application behavior exercised in the official packaged candidate passed, and no data-loss or authorization failure was found. Phase 8 still has required release gates marked FAIL or NOT VERIFIED. Release approval requires a trusted signing identity plus clean-install and in-place-upgrade evidence from a disposable Windows environment.
