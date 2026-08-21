import crypto from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";

/**
 * Counts what a PartFlow profile database actually holds, by opening the file.
 *
 * The write-load suite asks the renderer for its collection sizes, and that
 * answer depends on when it is asked: a collection is briefly unreadable while
 * the app rewrites it after sign-in, and a read landing in that window
 * reported zero stock movements on a shop holding 178,000 of them. Which is
 * indistinguishable, from inside the app, from having genuinely lost them.
 *
 * This is the tie-breaker. It reads the encrypted database itself, with no app
 * running, so "the data is on disk" and "the app can currently see it" become
 * two separate questions with two separate answers.
 *
 * The key derivation mirrors electron/main.cjs exactly: the database is bound
 * to this machine, which is the point of the encryption, not an obstacle to it.
 */

const APP_SALT = "autoparts-inventory-system-v1-local-license";
const STORE_PREFIX = "autoparts_inventory_v1::";
const CHUNKED_TOMBSTONE = '"__partflow_chunked__"';

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function machineMaterial(): string {
  try {
    // Same source the app uses. Loaded through createRequire rather than a
    // static import so a machine without the native module falls back to the
    // hostname digest instead of failing at import time.
    const { machineIdSync } = createRequire(import.meta.url)("node-machine-id") as {
      machineIdSync: (original: boolean) => string;
    };
    return machineIdSync(true);
  } catch {
    return sha256(
      [os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"]
        .filter(Boolean)
        .join("|"),
    );
  }
}

export function profileDbKey(): string {
  return sha256(`${APP_SALT}:db:${machineMaterial()}`);
}

/**
 * Sizes of the named collections as stored on disk.
 *
 * Mirrors lsCount in src/lib/storage: a plain row that parses to an array
 * wins, and only a tombstoned row defers to the chunk manifest.
 */
export function countCollectionsOnDisk(dbPath: string, names: string[]): Record<string, number> {
  // Loaded lazily: a machine without the native module should fail the one
  // assertion that needs it, not the whole suite at import time.
  const Database = createRequire(import.meta.url)("better-sqlite3-multiple-ciphers") as new (
    path: string,
    options?: unknown,
  ) => {
    pragma(source: string): unknown;
    prepare(sql: string): { get(key: string): { value?: string } | undefined };
    close(): void;
  };

  const db = new Database(dbPath, { readonly: true });
  try {
    db.pragma(`key="x'${profileDbKey()}'"`);
    const read = db.prepare("SELECT value FROM kv_store WHERE key = ?");
    const row = (key: string): string | null => read.get(key)?.value ?? null;

    const counts: Record<string, number> = {};
    for (const name of names) {
      const plain = row(`${STORE_PREFIX}${name}`);
      if (plain !== null && plain !== CHUNKED_TOMBSTONE) {
        try {
          const parsed = JSON.parse(plain);
          if (Array.isArray(parsed)) {
            counts[name] = parsed.length;
            continue;
          }
        } catch {
          /* fall through to the manifest */
        }
      }
      const meta = row(`${STORE_PREFIX}${name}#meta`);
      if (meta) {
        try {
          const total = Number((JSON.parse(meta) as { total?: number }).total);
          counts[name] = Number.isInteger(total) && total >= 0 ? total : 0;
          continue;
        } catch {
          /* fall through */
        }
      }
      counts[name] = 0;
    }
    return counts;
  } finally {
    db.close();
  }
}
