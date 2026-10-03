"use strict";

// Run with Electron's Node runtime (native SQLite is built for Electron):
//   $env:ELECTRON_RUN_AS_NODE='1'; npx electron scripts/phase12-query-benchmark.cjs --db ... --out ...

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");
const projection = require("../electron/query-projection.cjs");

function arg(name) { const i=process.argv.indexOf(name); return i>=0 ? process.argv[i+1] : null; }
const source=path.resolve(arg("--db")||"");
const out=path.resolve(arg("--out")||"");
if(!source||!out||!fs.existsSync(source)) throw new Error("usage: --db <isolated fixture db> --out <json>");
const label=arg("--label")||path.basename(path.dirname(path.dirname(source)));
const APP_SALT="autoparts-inventory-system-v1-local-license";
const sha256=(s)=>crypto.createHash("sha256").update(s).digest("hex");
function machineMaterial(){try{return machineIdSync(true);}catch{return sha256([os.hostname(),os.platform(),os.arch(),os.cpus()?.[0]?.model||"cpu"].join("|"));}}
const key=sha256(`${APP_SALT}:db:${machineMaterial()}`);
const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),`partflow-phase12-${label}-`));
const dbPath=path.join(tempRoot,"autoparts-inventory.secure.sqlite");
fs.copyFileSync(source,dbPath);

function percentile(values,p){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]||0;}
function sample(fn,count=12){const values=[];let last;for(let i=0;i<count;i++){const s=performance.now();last=fn();values.push(performance.now()-s);}return {p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),min:Math.min(...values),max:Math.max(...values),runs:values,last};}
function compact(metric){return Object.fromEntries(Object.entries(metric).filter(([key])=>key!=="last").map(([key,value])=>[key,typeof value==="number"?Number(value.toFixed(3)):value]));}

const started=performance.now();
const db=new Database(dbPath);
db.pragma(`key="x'${key}'"`);
db.pragma("journal_mode = WAL");
projection.createSchema(db);
const entities=["products","customers","suppliers","salesInvoices","purchaseInvoices","salesReturns","purchaseReturns","cashEntries","quotations","stockMovements","mobileStockOpReceipts"];
const builds={};
for(const entity of entities){const s=performance.now();const result=projection.ensureEntity(db,entity);builds[entity]={...result,ms:Number((performance.now()-s).toFixed(3)),rssMiB:Number((process.memoryUsage().rss/1048576).toFixed(1))};}
db.pragma("wal_checkpoint(TRUNCATE)");
const sampleRows={
  product:db.prepare("SELECT party_name q FROM pf_query_records WHERE entity='products' AND party_name<>'' LIMIT 1").get(),
  customer:db.prepare("SELECT party_name q,id FROM pf_query_records WHERE entity='customers' AND party_name<>'' LIMIT 1").get(),
  supplier:db.prepare("SELECT party_name q,id FROM pf_query_records WHERE entity='suppliers' AND party_name<>'' LIMIT 1").get(),
  sale:db.prepare("SELECT id,number FROM pf_query_records WHERE entity='salesInvoices' ORDER BY date DESC,id DESC LIMIT 1").get(),
};
const allPermissions={products:true,customers:true,suppliers:true,salesInvoices:true,purchaseInvoices:true,quotations:true,sales:true,purchases:true,cash:true};
const dashboardColdStarted=performance.now();projection.dashboard(db,allPermissions);const dashboardColdMs=performance.now()-dashboardColdStarted;
const dashboard=sample(()=>projection.dashboard(db,allPermissions),5);
const productSearch=sample(()=>projection.queryPage(db,"products",{q:sampleRows.product.q,page:0,pageSize:30}),20);
const customerSearch=sample(()=>projection.queryPage(db,"customers",{q:sampleRows.customer.q,page:0,pageSize:30}),20);
const globalSearch=sample(()=>projection.search(db,{q:sampleRows.sale.number,limit:30},allPermissions),12);
const invoiceLookup=sample(()=>projection.recordDetail(db,"salesInvoices",sampleRows.sale.id),20);
const salesPage=sample(()=>projection.queryPage(db,"salesInvoices",{page:0,pageSize:30}),20);
const purchasePage=sample(()=>projection.queryPage(db,"purchaseInvoices",{page:0,pageSize:30}),20);
const dues=sample(()=>({sales:projection.queryPage(db,"salesInvoices",{outstanding:true,page:0,pageSize:30}),purchases:projection.queryPage(db,"purchaseInvoices",{outstanding:true,page:0,pageSize:30})}),12);
const customerStatement=sample(()=>projection.statement(db,"customer",sampleRows.customer.id,{page:0,pageSize:30}),12);
const supplierStatement=sample(()=>projection.statement(db,"supplier",sampleRows.supplier.id,{page:0,pageSize:30}),12);
const stockHistory=sample(()=>projection.queryPage(db,"stockMovements",{page:0,pageSize:30}),12);
const queryPlans={
  salesPage:projection.explain(db,"SELECT * FROM pf_query_records WHERE entity=@entity ORDER BY date DESC,id DESC LIMIT 30",{entity:"salesInvoices"}),
  invoiceNumber:projection.explain(db,"SELECT id FROM pf_query_records WHERE entity=@entity AND number=@number",{entity:"salesInvoices",number:sampleRows.sale.number}),
  customerStatement:projection.explain(db,"SELECT * FROM pf_query_records WHERE entity=@entity AND party_id=@party ORDER BY date DESC,id DESC LIMIT 30",{entity:"salesInvoices",party:sampleRows.customer.id}),
  stockHistory:projection.explain(db,"SELECT * FROM pf_query_records WHERE entity=@entity ORDER BY date DESC,id DESC LIMIT 30",{entity:"stockMovements"}),
};
const beforeWrite=db.prepare("SELECT value FROM kv_store WHERE key=?").get("autoparts_inventory_v1::salesInvoices#0000").value;
const writeCosts=[];
for(let i=0;i<12;i++){
  const s=performance.now();
  db.transaction(()=>{
    const now=new Date(Date.now()+i).toISOString();
    db.prepare("UPDATE kv_store SET value=?,updated_at=? WHERE key=?").run(beforeWrite,now,"autoparts_inventory_v1::salesInvoices#0000");
    db.prepare("UPDATE kv_store SET updated_at=? WHERE key=?").run(now,"autoparts_inventory_v1::salesInvoices#meta");
    projection.syncChangedEntities(db,{"autoparts_inventory_v1::salesInvoices#0000":beforeWrite,"autoparts_inventory_v1::salesInvoices#meta":db.prepare("SELECT value FROM kv_store WHERE key=?").get("autoparts_inventory_v1::salesInvoices#meta").value});
  })();
  writeCosts.push(performance.now()-s);
}
const integrity=db.pragma("integrity_check",{simple:true});
let cipherIntegrity="unsupported";try{const rows=db.pragma("cipher_integrity_check");cipherIntegrity=rows.length?rows:"ok";}catch(error){cipherIntegrity=`unsupported:${error.message}`;}
const recordCounts=Object.fromEntries(db.prepare("SELECT entity,COUNT(*) count FROM pf_query_records GROUP BY entity").all().map((row)=>[row.entity,row.count]));
const lineCounts=Object.fromEntries(db.prepare("SELECT entity,COUNT(*) count FROM pf_query_lines GROUP BY entity").all().map((row)=>[row.entity,row.count]));
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
const result={label,sourceDb:source,isolatedDb:dbPath,sourceBytes:fs.statSync(source).size,projectedBytes:fs.statSync(dbPath).size,projectionVersion:projection.VERSION,builds,recordCounts,lineCounts,benchmarks:{dashboardColdMs:Number(dashboardColdMs.toFixed(3)),dashboard:compact(dashboard),productSearch:compact(productSearch),customerSearch:compact(customerSearch),globalSearch:compact(globalSearch),invoiceLookup:compact(invoiceLookup),salesPage:compact(salesPage),purchasePage:compact(purchasePage),dues:compact(dues),customerStatement:compact(customerStatement),supplierStatement:compact(supplierStatement),stockHistory:compact(stockHistory),incrementalCanonicalWrite:{p50:Number(percentile(writeCosts,.5).toFixed(3)),p95:Number(percentile(writeCosts,.95).toFixed(3)),p99:Number(percentile(writeCosts,.99).toFixed(3))}},payloadBytes:{dashboard:Buffer.byteLength(JSON.stringify(dashboard.last)),globalSearch:Buffer.byteLength(JSON.stringify(globalSearch.last)),salesPage:Buffer.byteLength(JSON.stringify(salesPage.last)),stockHistory:Buffer.byteLength(JSON.stringify(stockHistory.last))},queryPlans,integrity,cipherIntegrity,peakRssMiB:Number((process.memoryUsage().rss/1048576).toFixed(1)),totalMs:Number((performance.now()-started).toFixed(3))};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify({label,out,projectedMiB:Number((result.projectedBytes/1048576).toFixed(1)),peakRssMiB:result.peakRssMiB,totalSeconds:Number((result.totalMs/1000).toFixed(1)),benchmarks:result.benchmarks},null,2));
