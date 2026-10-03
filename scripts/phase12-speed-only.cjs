"use strict";

const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {performance}=require("node:perf_hooks");
const Database=require("better-sqlite3-multiple-ciphers");
const {machineIdSync}=require("node-machine-id");
const projection=require("../electron/query-projection.cjs");
const arg=(name)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
const dbPath=path.resolve(arg("--db")||"");
const out=path.resolve(arg("--out")||"");
if(!fs.existsSync(dbPath)||!out)throw new Error("usage: --db <existing isolated projected db> --out <json>");
const sha=(value)=>crypto.createHash("sha256").update(value).digest("hex");
const material=(()=>{try{return machineIdSync(true);}catch{return sha([os.hostname(),os.platform(),os.arch(),os.cpus()?.[0]?.model||"cpu"].join("|"));}})();
const db=new Database(dbPath);
db.pragma(`key="x'${sha(`autoparts-inventory-system-v1-local-license:db:${material}`)}'"`);
const pct=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
const run=(fn,count=10)=>{const values=[];let last;for(let i=0;i<count;i++){const s=performance.now();last=fn();values.push(performance.now()-s);}return{p50:+pct(values,.5).toFixed(3),p95:+pct(values,.95).toFixed(3),p99:+pct(values,.99).toFixed(3),min:+Math.min(...values).toFixed(3),max:+Math.max(...values).toFixed(3),values:values.map(v=>+v.toFixed(3)),last};};
const permissions={products:true,customers:true,suppliers:true,salesInvoices:true,purchaseInvoices:true,quotations:true,sales:true,purchases:true,cash:true};
const sale=db.prepare("SELECT id,number FROM pf_query_records WHERE entity='salesInvoices' ORDER BY date DESC,id DESC LIMIT 1").get();
const customer=db.prepare("SELECT id,party_name q FROM pf_query_records WHERE entity='customers' AND party_name<>'' LIMIT 1").get();
const supplier=db.prepare("SELECT id,party_name q FROM pf_query_records WHERE entity='suppliers' AND party_name<>'' LIMIT 1").get();
const product=db.prepare("SELECT party_name q FROM pf_query_records WHERE entity='products' AND party_name<>'' LIMIT 1").get();

const dashboardFirst=run(()=>projection.dashboard(db,permissions),1);
const dashboardWarm=run(()=>projection.dashboard(db,permissions),10);
const productSearch=run(()=>projection.search(db,{q:product.q,limit:30},{products:true}),20);
const customerSearch=run(()=>projection.search(db,{q:customer.q,limit:30},{customers:true}),20);
const globalSearch=run(()=>projection.search(db,{q:sale.number,limit:30},permissions),12);
const invoiceLookup=run(()=>projection.recordDetail(db,"salesInvoices",sale.id),20);
const salesPage=run(()=>projection.queryPage(db,"salesInvoices",{page:0,pageSize:30}),20);
const purchasePage=run(()=>projection.queryPage(db,"purchaseInvoices",{page:0,pageSize:30}),20);
const dues=run(()=>({sales:projection.queryPage(db,"salesInvoices",{outstanding:true,page:0,pageSize:30}),purchases:projection.queryPage(db,"purchaseInvoices",{outstanding:true,page:0,pageSize:30})}),12);
const customerStatement=run(()=>projection.statement(db,"customer",customer.id,{page:0,pageSize:30}),12);
const supplierStatement=run(()=>projection.statement(db,"supplier",supplier.id,{page:0,pageSize:30}),12);
const stockHistory=run(()=>projection.queryPage(db,"stockMovements",{page:0,pageSize:30}),12);

// Measures the real WAL transaction boundary only.  A manual checkpoint after
// every sale is not part of PartFlow's write path and materially distorted the
// earlier exploratory number.
const prefix="autoparts_inventory_v1::salesInvoices";
const chunkKey=db.prepare("SELECT key FROM kv_store WHERE key LIKE ? AND key GLOB '*#[0-9]*' ORDER BY key DESC LIMIT 1").get(`${prefix}#%`).key;
const raw=db.prepare("SELECT value FROM kv_store WHERE key=?").get(chunkKey).value;
const meta=db.prepare("SELECT value FROM kv_store WHERE key=?").get(`${prefix}#meta`).value;
const writeValues=[];
for(let i=0;i<12;i++){
  const s=performance.now();
  db.transaction(()=>{
    const at=new Date(Date.now()+i).toISOString();
    db.prepare("UPDATE kv_store SET value=?,updated_at=? WHERE key=?").run(raw,at,chunkKey);
    db.prepare("UPDATE kv_store SET value=?,updated_at=? WHERE key=?").run(meta,at,`${prefix}#meta`);
    projection.syncChangedEntities(db,{[chunkKey]:raw,[`${prefix}#meta`]:meta});
  })();
  writeValues.push(performance.now()-s);
}
const strip=(metric)=>{const {last,...rest}=metric;return rest;};
const result={
  scope:"speed-only; existing isolated 200K projection; no rebuild, no integrity scan, no checkpoint-per-write",
  dbPath,dbBytes:fs.statSync(dbPath).size,
  benchmarks:{dashboardFirst:strip(dashboardFirst),dashboardWarm:strip(dashboardWarm),productSearch:strip(productSearch),customerSearch:strip(customerSearch),globalSearch:strip(globalSearch),invoiceLookup:strip(invoiceLookup),salesPage:strip(salesPage),purchasePage:strip(purchasePage),dues:strip(dues),customerStatement:strip(customerStatement),supplierStatement:strip(supplierStatement),stockHistory:strip(stockHistory),canonicalWrite:{p50:+pct(writeValues,.5).toFixed(3),p95:+pct(writeValues,.95).toFixed(3),p99:+pct(writeValues,.99).toFixed(3),values:writeValues.map(v=>+v.toFixed(3))}},
  payloadBytes:{dashboard:Buffer.byteLength(JSON.stringify(dashboardWarm.last)),productSearch:Buffer.byteLength(JSON.stringify(productSearch.last)),globalSearch:Buffer.byteLength(JSON.stringify(globalSearch.last)),salesPage:Buffer.byteLength(JSON.stringify(salesPage.last)),stockHistory:Buffer.byteLength(JSON.stringify(stockHistory.last))},
  rssMiB:+(process.memoryUsage().rss/1048576).toFixed(1),measuredAt:new Date().toISOString(),
};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,`${JSON.stringify(result,null,2)}\n`);
db.close();
console.log(JSON.stringify({out,benchmarks:result.benchmarks,payloadBytes:result.payloadBytes,rssMiB:result.rssMiB},null,2));
