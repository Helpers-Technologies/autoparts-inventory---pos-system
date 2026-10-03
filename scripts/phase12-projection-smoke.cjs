"use strict";

const assert=require("node:assert/strict");
const Database=require("better-sqlite3-multiple-ciphers");
const projection=require("../electron/query-projection.cjs");
const db=new Database(":memory:");
db.exec("CREATE TABLE kv_store(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
const put=db.prepare("INSERT INTO kv_store VALUES(?,?,?)");
const prefix="autoparts_inventory_v1::";
const now="2026-09-27T00:00:00.000Z";
const collections={
  salesInvoices:[
    {id:"s2",invoiceNumber:"INV-2",date:"2026-09-27",customerId:"c1",customerName:"Ahmed",total:20,amountReceived:5,remaining:15,status:"partial",lines:[{id:"l2",productId:"p1",productName:"Brake Pad",quantity:1,subtotal:20,costPrice:10}]},
    {id:"s1",invoiceNumber:"INV-1",date:"2026-09-27",customerId:"c1",customerName:"Ahmed",total:10,amountReceived:10,remaining:0,status:"paid",lines:[{id:"l1",productId:"p1",productName:"Brake Pad",quantity:1,subtotal:10,costPrice:5}]},
  ],
  purchaseInvoices:[{id:"b1",invoiceNumber:"PUR-1",date:"2026-09-26",supplierId:"v1",supplierName:"Vendor",total:40,amountPaid:10,remaining:30,status:"partial",lines:[]}],salesReturns:[],cashEntries:[],products:[{id:"p1",name:"Brake Pad",code:"P-1",quantity:4,avgCost:5}],
  customers:[{id:"c1",name:"Ahmed",code:"C-1",phone:"01012345678"}],suppliers:[{id:"v1",name:"Vendor",code:"V-1",phone:"01000000000"}],quotations:[],stockMovements:[],purchaseReturns:[],mobileStockOpReceipts:[],
};
for(const [entity,rows] of Object.entries(collections)){
  put.run(`${prefix}${entity}`,'"__partflow_chunked__"',now);
  put.run(`${prefix}${entity}#0000`,JSON.stringify(rows),now);
  put.run(`${prefix}${entity}#meta`,JSON.stringify({chunks:1,size:500,total:rows.length}),now);
}
put.run(`${prefix}settings`,JSON.stringify({openingBalance:0}),now);
projection.createSchema(db);
projection.runUpgrade(db);
assert.equal(projection.queryPage(db,"salesInvoices",{page:0,pageSize:1}).rows[0].id,"s2");
assert.equal(projection.queryPage(db,"salesInvoices",{outstanding:true,page:0,pageSize:30}).total,1);
assert.equal(projection.recordDetail(db,"salesInvoices","s1").invoiceNumber,"INV-1");
assert.equal(projection.catalogSearch(db,"customers",{q:"010123",limit:20})[0].id,"c1");
assert.equal(projection.catalogSearch(db,"customers",{q:"C-1",limit:20})[0].balance,15);
assert.equal(projection.catalogDetail(db,"customers","c1").financialSummary.balance,15);
assert.equal(projection.statement(db,"customer","c1",{page:0,pageSize:30}).balance,15);
const allParties=projection.duesParties(db,{kind:"all",page:0,pageSize:1});
assert.equal(allParties.total,2);
assert.equal(allParties.rows.length,1);
assert.equal(projection.duesParties(db,{kind:"all",direction:"weOweThem",page:0,pageSize:30}).rows[0].type,"supplier");
assert.equal(projection.search(db,{q:"INV-2",limit:30},{salesInvoices:true})[0].id,"s2");
const before=projection.dashboard(db,{sales:true,purchases:true,cash:true,customers:true,suppliers:true},new Date("2026-09-27T12:00:00"));
assert.equal(before.stats.todaySales,30);
const changed=[...collections.salesInvoices,{id:"s3",invoiceNumber:"INV-3",date:"2026-09-27",customerId:"c1",customerName:"Ahmed",total:5,amountReceived:0,remaining:5,status:"unpaid",lines:[]}];
const changedAt="2026-09-27T00:00:01.000Z";
db.transaction(()=>{
  const previous=projection.captureChangedEntities(db,{[`${prefix}salesInvoices#0000`]:JSON.stringify(changed),[`${prefix}salesInvoices#meta`]:JSON.stringify({chunks:1,size:500,total:3})});
  db.prepare("UPDATE kv_store SET value=?,updated_at=? WHERE key=?").run(JSON.stringify(changed),changedAt,`${prefix}salesInvoices#0000`);
  db.prepare("UPDATE kv_store SET value=?,updated_at=? WHERE key=?").run(JSON.stringify({chunks:1,size:500,total:3}),changedAt,`${prefix}salesInvoices#meta`);
  projection.syncChangedEntities(db,{[`${prefix}salesInvoices#0000`]:JSON.stringify(changed),[`${prefix}salesInvoices#meta`]:JSON.stringify({chunks:1,size:500,total:3})},previous);
})();
assert.equal(projection.queryPage(db,"salesInvoices",{outstanding:true,page:0,pageSize:30}).total,2);
assert.equal(projection.recordDetail(db,"salesInvoices","s3").remaining,5);
const changedProducts=[{...collections.products[0],quantity:3}];
db.transaction(()=>{
  const entries={[`${prefix}products#0000`]:JSON.stringify(changedProducts)};
  const previous=projection.captureChangedEntities(db,entries);
  db.prepare("UPDATE kv_store SET value=?,updated_at=? WHERE key=?").run(JSON.stringify(changedProducts),changedAt,`${prefix}products#0000`);
  db.prepare("UPDATE kv_store SET updated_at=? WHERE key=?").run(changedAt,`${prefix}products#meta`);
  projection.syncChangedEntities(db,entries,previous);
})();
assert.equal(projection.catalogDetail(db,"products","p1").quantity,3);
const markerBefore=db.prepare("SELECT * FROM pf_query_projection_meta WHERE entity='salesInvoices'").get();
db.prepare("UPDATE kv_store SET value='not-json',updated_at=? WHERE key=?").run("2026-09-27T00:00:02.000Z",`${prefix}salesInvoices#0000`);
assert.throws(()=>projection.rebuildEntity(db,"salesInvoices"));
assert.deepEqual(db.prepare("SELECT * FROM pf_query_projection_meta WHERE entity='salesInvoices'").get(),markerBefore);
console.log(JSON.stringify({ok:true,records:db.prepare("SELECT COUNT(*) count FROM pf_query_records").get().count,integrity:db.pragma("integrity_check",{simple:true})}));
db.close();
