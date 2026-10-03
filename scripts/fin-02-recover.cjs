// SQLCipher crash recovery only, restricted to the synthetic FIN audit workspace.
const path = require("node:path"), crypto = require("node:crypto");
const Database = require("better-sqlite3-multiple-ciphers");
const root = path.resolve(__dirname, "../reports/financial-accounting-audit-2026-10");
const target = path.resolve(process.argv[2]);
if (!target.startsWith(root + path.sep)) throw new Error("ISOLATED_FIN02_DATABASE_REQUIRED");
const machine = require("node-machine-id").machineIdSync(true);
const key = crypto.createHash("sha256").update("autoparts-inventory-system-v1-local-license:db:" + machine).digest("hex");
const db = new Database(target, {fileMustExist:true});
db.pragma(`key="x'${key}'"`);
db.prepare("SELECT COUNT(*) FROM kv_store").get();
process.stdout.write(JSON.stringify({operation:"SQLite hot-journal recovery; no business mutations", integrity:db.pragma("integrity_check")}));
db.close();
