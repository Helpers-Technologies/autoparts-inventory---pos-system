"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");
const projection = require("../electron/query-projection.cjs");

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const dbPath = path.resolve(option("--db") || "");
const outPath = path.resolve(option("--out") || "");
const label = option("--label") || path.basename(path.dirname(dbPath));
if (!dbPath || !outPath || !fs.existsSync(dbPath)) {
  throw new Error("usage: phase13-query-profile.cjs --db <projected-db> --out <json> [--label <name>]");
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let machineMaterial;
try { machineMaterial = machineIdSync(true); }
catch { machineMaterial = sha256([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"].join("|")); }

const db = new Database(dbPath, { fileMustExist: true });
db.pragma(`key="x'${sha256(`autoparts-inventory-system-v1-local-license:db:${machineMaterial}`)}'"`);

const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
const sample = (fn, runs = 12) => {
  const values = [];
  let last;
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    last = fn();
    values.push(performance.now() - started);
  }
  return {
    p50: Number(percentile(values, 0.5).toFixed(3)),
    p95: Number(percentile(values, 0.95).toFixed(3)),
    p99: Number(percentile(values, 0.99).toFixed(3)),
    values: values.map((value) => Number(value.toFixed(3))),
    resultRows: Array.isArray(last) ? last.length : undefined,
  };
};
const plan = (sql, params = {}) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params);

const counts = Object.fromEntries(db.prepare("SELECT entity, canonical_count count FROM pf_query_projection_meta ORDER BY entity").all().map((row) => [row.entity, row.count]));
const busiestCustomer = db.prepare("SELECT party_id id, COUNT(*) invoiceCount FROM pf_query_records WHERE entity='salesInvoices' AND party_id<>'' GROUP BY party_id ORDER BY invoiceCount DESC LIMIT 1").get();
const exactSale = db.prepare("SELECT number FROM pf_query_records WHERE entity='salesInvoices' AND number<>'' ORDER BY date DESC,id DESC LIMIT 1").get();
const commonCustomer = db.prepare("SELECT name,code,phone FROM pf_catalog_search WHERE entity='customers' AND archived=0 AND code<>'' LIMIT 1").get();
const permissions = { products:true, customers:true, suppliers:true, salesInvoices:true, purchaseInvoices:true, quotations:true, sales:true, purchases:true, cash:true };

const statementParams = { entity: "salesInvoices", partyId: busiestCustomer.id, limit: 50, offset: 0 };
const statementWhere = "entity=@entity AND party_id=@partyId";
const countSql = `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN cancelled=0 THEN total ELSE 0 END),0) AS total, COALESCE(SUM(CASE WHEN cancelled=0 THEN paid ELSE 0 END),0) AS paid, COALESCE(SUM(CASE WHEN cancelled=0 THEN remaining ELSE 0 END),0) AS remaining FROM pf_query_records INDEXED BY idx_pf_records_entity_party_date WHERE ${statementWhere}`;
const rowsSql = `SELECT * FROM pf_query_records INDEXED BY idx_pf_records_entity_party_date WHERE ${statementWhere} ORDER BY date DESC,id DESC LIMIT @limit OFFSET @offset`;
const balanceSql = "SELECT COALESCE(SUM(remaining-overpayment),0) balance FROM pf_query_records WHERE entity=@entity AND party_id=@partyId AND cancelled=0";
const partyBalanceSql = "SELECT balance,open_invoices FROM pf_party_balances WHERE entity=@entity AND party_id=@partyId";
const exactInvoiceSql = "SELECT id,number,party_name,date,status FROM pf_query_records INDEXED BY idx_pf_records_entity_number WHERE entity=@entity AND number=@number COLLATE NOCASE LIMIT 8";
const exactInvoiceParams = { entity:"salesInvoices", number:exactSale.number.toLocaleLowerCase("en") };

const customerSearchTerm = String(commonCustomer?.code || commonCustomer?.phone || commonCustomer?.name || "customer");
const escapedCustomer = customerSearchTerm.toLocaleLowerCase("en").replace(/[\\%_]/g, "\\$&");
const catalogSql = `SELECT id,name,code,phone FROM pf_catalog_search WHERE entity=@entity AND archived=0
  AND (code LIKE @prefix ESCAPE '\\' COLLATE NOCASE OR name LIKE @contains ESCAPE '\\' COLLATE NOCASE OR phone LIKE @contains ESCAPE '\\')
  ORDER BY CASE WHEN code=@q COLLATE NOCASE THEN 0 WHEN code LIKE @prefix ESCAPE '\\' COLLATE NOCASE THEN 1 ELSE 2 END,name,id LIMIT 8`;
const catalogParams = { entity:"customers", q:escapedCustomer, prefix:`${escapedCustomer}%`, contains:`%${escapedCustomer}%` };

const dashboardProfileStarted = performance.now();
db.prepare("DELETE FROM pf_dashboard_cache").run();
const dashboardCold = projection.dashboard(db, { ...permissions, __profile: true });
const dashboardColdMs = performance.now() - dashboardProfileStarted;
const dashboardColdRuns=[];
for(let index=0;index<7;index+=1){
  db.prepare("DELETE FROM pf_dashboard_cache").run();
  const started=performance.now();
  const value=projection.dashboard(db,{...permissions,__profile:true});
  dashboardColdRuns.push({milliseconds:Number((performance.now()-started).toFixed(3)),profile:value._profile});
}

const result = {
  label,
  database: { path: dbPath, bytes: fs.statSync(dbPath).size, counts },
  inputs: { busiestCustomer, exactInvoice: exactSale.number, customerQuery: customerSearchTerm, customer:commonCustomer },
  benchmarks: {
    globalSearchExactInvoice: sample(() => projection.search(db, { q: exactSale.number, limit: 30 }, permissions)),
    exactInvoiceSql: sample(() => db.prepare(exactInvoiceSql).all(exactInvoiceParams), 20),
    globalSearchCustomerContains: sample(() => projection.search(db, { q: customerSearchTerm, limit: 30 }, permissions)),
    customerCatalogQuery: sample(() => db.prepare(catalogSql).all(catalogParams), 20),
    statementTotal: sample(() => projection.statement(db, "customer", busiestCustomer.id, { page:0, pageSize:50 })),
    statementAggregate: sample(() => db.prepare(countSql).get(statementParams), 20),
    statementRows: sample(() => db.prepare(rowsSql).all(statementParams), 20),
    statementLegacyBalance: sample(() => db.prepare(balanceSql).get(statementParams), 20),
    statementProjectedBalance: sample(() => db.prepare(partyBalanceSql).get(statementParams), 20),
    dashboardCold: { milliseconds:Number(dashboardColdMs.toFixed(3)), profile:dashboardCold._profile },
    dashboardColdRuns: {
      p50:Number(percentile(dashboardColdRuns.map((row)=>row.milliseconds),.5).toFixed(3)),
      p95:Number(percentile(dashboardColdRuns.map((row)=>row.milliseconds),.95).toFixed(3)),
      values:dashboardColdRuns,
    },
    dashboardWarm: sample(() => projection.dashboard(db, permissions), 12),
  },
  plans: {
    customerCatalog: plan(catalogSql, catalogParams),
    exactInvoice: plan(exactInvoiceSql, exactInvoiceParams),
    statementAggregate: plan(countSql, statementParams),
    statementRows: plan(rowsSql, statementParams),
    statementLegacyBalance: plan(balanceSql, statementParams),
    statementProjectedBalance: plan(partyBalanceSql, statementParams),
  },
  memory: { rssMiB:Number((process.memoryUsage().rss / 1048576).toFixed(1)), heapUsedMiB:Number((process.memoryUsage().heapUsed / 1048576).toFixed(1)) },
  measuredAt: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(outPath), { recursive:true });
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
db.close();
process.stdout.write(`${JSON.stringify({ outPath, label, benchmarks:result.benchmarks, memory:result.memory }, null, 2)}\n`);
