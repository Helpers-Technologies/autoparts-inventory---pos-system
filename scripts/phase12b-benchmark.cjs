"use strict";

const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {performance}=require("node:perf_hooks");
const Database=require("better-sqlite3-multiple-ciphers");
const {machineIdSync}=require("node-machine-id");
const projection=require("../electron/query-projection.cjs");
const arg=(name)=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const source=path.resolve(arg("--db")||""),out=path.resolve(arg("--out")||"");
if(!source||!out||!fs.existsSync(source))throw new Error("usage: --db <fixture> --out <json>");
const label=arg("--label")||path.basename(path.dirname(path.dirname(source)));
const hash=(value)=>crypto.createHash("sha256").update(value).digest("hex");
const material=(()=>{try{return machineIdSync(true);}catch{return hash([os.hostname(),os.platform(),os.arch(),os.cpus()?.[0]?.model||"cpu"].join("|"));}})();
const key=hash(`autoparts-inventory-system-v1-local-license:db:${material}`);
const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),`partflow-phase12b-${label}-`));
const dbPath=path.join(tempRoot,"autoparts-inventory.secure.sqlite");fs.copyFileSync(source,dbPath);
const sourceBytes=fs.statSync(source).size,started=performance.now();let peakRss=process.memoryUsage().rss,peakDisk=sourceBytes;
const observe=()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);for(const suffix of ["","-wal","-shm"]){const file=`${dbPath}${suffix}`;if(fs.existsSync(file))peakDisk=Math.max(peakDisk,fs.statSync(dbPath).size+(fs.existsSync(`${dbPath}-wal`)?fs.statSync(`${dbPath}-wal`).size:0));}};
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]||0;
const sample=(fn,count=12)=>{const runs=[];let last;for(let i=0;i<count;i++){const s=performance.now();last=fn();runs.push(performance.now()-s);observe();}return{p50:percentile(runs,.5),p95:percentile(runs,.95),p99:percentile(runs,.99),min:Math.min(...runs),max:Math.max(...runs),runs,last};};
const compact=(metric)=>Object.fromEntries(Object.entries(metric).filter(([k])=>k!=="last").map(([k,v])=>[k,typeof v==="number"?Number(v.toFixed(3)):v]));
const db=new Database(dbPath);db.pragma(`key="x'${key}'"`);db.pragma("journal_mode=WAL");projection.createSchema(db);
const entities=["salesInvoices","purchaseInvoices","salesReturns","purchaseReturns","cashEntries","quotations","stockMovements","products","customers","suppliers"];
const builds={};for(const entity of entities){const s=performance.now();const result=projection.ensureEntity(db,entity);observe();builds[entity]={...result,ms:Number((performance.now()-s).toFixed(3)),rssMiB:Number((process.memoryUsage().rss/1048576).toFixed(1))};}
const migrationMs=performance.now()-started;db.pragma("wal_checkpoint(TRUNCATE)");observe();
const canonicalFirst=(entity)=>{const state=projection.canonicalState(db,entity);if(Array.isArray(state.plain))return state.plain[0];return JSON.parse(db.prepare("SELECT value FROM kv_store WHERE key=?").get(`autoparts_inventory_v1::${entity}#0000`).value)[0];};
const canonicalAll=(entity)=>{const state=projection.canonicalState(db,entity);if(Array.isArray(state.plain))return state.plain;const rows=[];const get=db.prepare("SELECT value FROM kv_store WHERE key=?");for(let i=0;i<state.chunks;i++)rows.push(...JSON.parse(get.get(`autoparts_inventory_v1::${entity}#${String(i).padStart(4,"0")}`).value));return rows;};
const product=canonicalFirst("products"),customer=canonicalFirst("customers"),supplier=canonicalFirst("suppliers");
const operationalProducts=canonicalAll("products").filter((row)=>!row.archived);
const productSearch=(term)=>{const q=String(term||"").toLocaleLowerCase("en");return operationalProducts.filter((row)=>[row.code,row.partNumber,row.barcode,row.name,row.partBrand,...(Array.isArray(row.oemNumbers)?row.oemNumbers:[])].some((value)=>String(value||"").toLocaleLowerCase("en").includes(q))).slice(0,8);};
const sale=db.prepare("SELECT id,number FROM pf_query_records WHERE entity='salesInvoices' ORDER BY date DESC,id DESC LIMIT 1").get();
const permissions={products:true,customers:true,suppliers:true,salesInvoices:true,purchaseInvoices:true,quotations:true,sales:true,purchases:true,cash:true};
const coldStart=performance.now();const coldDashboard=projection.dashboard(db,{...permissions,__profile:true});const dashboardColdMs=performance.now()-coldStart;
const metrics={
  dashboard:sample(()=>projection.dashboard(db,permissions),7),
  productSearch:sample(()=>productSearch(product.partNumber||product.code||product.name),20),
  productPrefix:sample(()=>productSearch(String(product.partNumber||product.code||product.name).slice(0,5)),20),
  productBarcode:product.barcode?sample(()=>productSearch(product.barcode),20):null,
  productOem:Array.isArray(product.oemNumbers)&&product.oemNumbers[0]?sample(()=>productSearch(product.oemNumbers[0]),20):null,
  customerSearch:sample(()=>projection.search(db,{q:customer.code||customer.name,limit:30},{customers:true}),20),
  globalSearch:sample(()=>projection.search(db,{q:sale.number,limit:30},permissions),12),
  invoiceLookup:sample(()=>projection.recordDetail(db,"salesInvoices",sale.id),20),
  salesPage:sample(()=>projection.queryPage(db,"salesInvoices",{page:0,pageSize:30}),20),
  purchasePage:sample(()=>projection.queryPage(db,"purchaseInvoices",{page:0,pageSize:30}),20),
  dues:sample(()=>projection.queryPage(db,"salesInvoices",{outstanding:true,page:0,pageSize:30}),12),
  customerStatement:sample(()=>projection.statement(db,"customer",customer.id,{page:0,pageSize:30}),12),
  supplierStatement:sample(()=>projection.statement(db,"supplier",supplier.id,{page:0,pageSize:30}),12),
  returnsPage:sample(()=>projection.queryPage(db,"salesReturns",{page:0,pageSize:30}),12),
  quotationsPage:sample(()=>projection.queryPage(db,"quotations",{page:0,pageSize:30}),12),
  stockHistory:sample(()=>projection.queryPage(db,"stockMovements",{page:0,pageSize:30}),12),
};
const chunkKey="autoparts_inventory_v1::salesInvoices#0000",metaKey="autoparts_inventory_v1::salesInvoices#meta";
const chunk=db.prepare("SELECT value FROM kv_store WHERE key=?").get(chunkKey).value,meta=db.prepare("SELECT value FROM kv_store WHERE key=?").get(metaKey).value;
const writes=[];for(let i=0;i<12;i++){const entries={[chunkKey]:chunk,[metaKey]:meta};const s=performance.now();db.transaction(()=>{const previous=projection.captureChangedEntities(db,entries);const now=new Date(Date.now()+i).toISOString();db.prepare("UPDATE kv_store SET value=?,updated_at=? WHERE key=?").run(chunk,now,chunkKey);db.prepare("UPDATE kv_store SET value=?,updated_at=? WHERE key=?").run(meta,now,metaKey);projection.syncChangedEntities(db,entries,previous);})();writes.push(performance.now()-s);observe();}
const storage=db.prepare("SELECT name,SUM(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC").all();
const plans={salesPage:projection.explain(db,"SELECT * FROM pf_query_records WHERE entity='salesInvoices' ORDER BY date DESC,id DESC LIMIT 30"),invoiceNumber:projection.explain(db,"SELECT id FROM pf_query_records WHERE entity='salesInvoices' AND number=? COLLATE NOCASE",[sale.number]),customerStatement:projection.explain(db,"SELECT * FROM pf_query_records WHERE entity='salesInvoices' AND party_id=? ORDER BY date DESC,id DESC LIMIT 30",[customer.id]),stockHistory:projection.explain(db,"SELECT * FROM pf_stock_movements ORDER BY date DESC,id DESC LIMIT 30")};
const integrity=db.pragma("integrity_check",{simple:true});let cipherIntegrity="unsupported";try{const rows=db.pragma("cipher_integrity_check");cipherIntegrity=rows.length?rows:"ok";}catch(error){cipherIntegrity=`unsupported:${error.message}`;}
db.pragma("wal_checkpoint(TRUNCATE)");db.close();const finalBytes=fs.statSync(dbPath).size;
const result={label,sourceDb:source,isolatedDb:dbPath,sourceBytes,finalBytes,amplification:Number((finalBytes/sourceBytes).toFixed(3)),migration:{ms:Number(migrationMs.toFixed(3)),peakRssMiB:Number((peakRss/1048576).toFixed(1)),peakDiskBytes:peakDisk,temporaryAmplification:Number((peakDisk/sourceBytes).toFixed(3))},builds,benchmarks:{dashboardColdMs:Number(dashboardColdMs.toFixed(3)),dashboardColdProfile:coldDashboard._profile,...Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,v?compact(v):null])),durableWrite:{cold:Number(writes[0].toFixed(3)),p50:Number(percentile(writes,.5).toFixed(3)),p95:Number(percentile(writes,.95).toFixed(3)),p99:Number(percentile(writes,.99).toFixed(3))}},payloadBytes:{dashboard:Buffer.byteLength(JSON.stringify(coldDashboard)),salesPage:Buffer.byteLength(JSON.stringify(metrics.salesPage.last)),stockHistory:Buffer.byteLength(JSON.stringify(metrics.stockHistory.last))},plans,storage,integrity,cipherIntegrity,totalMs:Number((performance.now()-started).toFixed(3))};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify({label,finalMiB:Number((finalBytes/1048576).toFixed(1)),amplification:result.amplification,migrationSeconds:Number((migrationMs/1000).toFixed(1)),benchmarks:result.benchmarks},null,2));
