// Electron ABI helper. Writes only new FIN-01 fixtures. Inspect mode is readonly.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Database=require('better-sqlite3-multiple-ciphers');
const root=path.resolve(__dirname,'../reports/financial-accounting-audit-2026-10');
const [operation,file,out]=process.argv.slice(2),target=path.resolve(file);
if(!target.startsWith(root+path.sep))throw Error('FIN01_ISOLATED_PATH_REQUIRED');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const machine=require('node-machine-id').machineIdSync(true),key=sha('autoparts-inventory-system-v1-local-license:db:'+machine),prefix='autoparts_inventory_v1::';
const names=['products','customers','suppliers','purchaseInvoices','salesInvoices','salesReturns','purchaseReturns','cashEntries','stockMovements','branchStocks','branches','stockTransfers','stocktakes','quotations','shifts','auditLogs','drivers','deliveryOrders','customerVehicles','warrantyClaims','offlineEmployees','offlineTransactions','priceTiers'];
function read(db,name){const value=db.prepare('SELECT value FROM kv_store WHERE key=?').get(prefix+name)?.value;if(!value)return null;const raw=JSON.parse(value);if(raw!=='__partflow_chunked__')return raw;const meta=read(db,name+'#meta');return Array.from({length:meta.chunks},(_,i)=>read(db,name+'#'+String(i).padStart(4,'0'))).flat();}
if(operation==='seed'){
  if(fs.existsSync(target))throw Error('REFUSE_OVERWRITE_FIXTURE');fs.mkdirSync(path.dirname(target),{recursive:true});
  const source=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../reports/system-audit-2026-09-14/load-small.json'),'utf8')).sourceDb;
  const input=new Database(source,{readonly:true,fileMustExist:true});input.pragma(`key="x'${key}'"`);
  const settings=read(input,'settings'),users=read(input,'users');input.close();
  const db=new Database(target);db.pragma(`key="x'${key}'"`);db.exec('CREATE TABLE kv_store(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)');
  const put=(name,value)=>db.prepare('INSERT INTO kv_store VALUES(?,?,?)').run(prefix+name,JSON.stringify(value),'2026-10-03T00:00:00Z');
  db.transaction(()=>{
    for(const name of names)put(name,[]);
    const replace=(name,value)=>db.prepare('UPDATE kv_store SET value=? WHERE key=?').run(JSON.stringify(value),prefix+name);
    put('settings',{...settings,openingBalance:10000,currency:'EGP',maxReturnDays:999,features:{...settings.features,creditPayment:true,creditSales:true,quotations:true}});
    put('users',users.filter(u=>u.role==='owner'));put('autoPartsStarterCatalogVersion',3);put('nextProductCode',3);put('nextCustomerCode',3);put('nextSupplierCode',3);
    const date='2026-10-03T00:00:00Z';
    replace('products',[{id:'fin-product',code:'FIN001',name:'FIN audit product',category:'FIN',unit:'unit',purchasePrice:50,avgCost:50,wholesalePrice:100,retailPrice:100,quantity:1000,looseQuantity:0,minStock:0,hasExpiry:false,archived:false,createdAt:date},{id:'fin-pieces',code:'FIN002',name:'FIN audit pieces',category:'FIN',unit:'box',purchasePrice:120,avgCost:120,wholesalePrice:240,retailPrice:240,retailUnitPrice:20,piecesPerUnit:12,quantity:100,looseQuantity:0,minStock:0,hasExpiry:false,archived:false,createdAt:date}]);
    replace('customers',[{id:'walkin',code:'C001',name:'FIN walkin',createdAt:date},{id:'fin-customer',code:'C002',name:'FIN customer',createdAt:date}]);
    replace('suppliers',[{id:'fin-supplier',code:'S001',name:'FIN supplier',createdAt:date}]);
    replace('branches',[{id:'fin-main',code:'MAIN',name:'FIN main',isMain:true,active:true,createdAt:date},{id:'fin-other',code:'OTHER',name:'FIN other',isMain:false,active:true,createdAt:date}]);
    replace('branchStocks',[{branchId:'fin-main',productId:'fin-product',quantity:600,updatedAt:date},{branchId:'fin-other',productId:'fin-product',quantity:400,updatedAt:date},{branchId:'fin-main',productId:'fin-pieces',quantity:60,updatedAt:date},{branchId:'fin-other',productId:'fin-pieces',quantity:40,updatedAt:date}]);
    // Normal current persistence layout; preserve the earlier plain-array runs
    // separately as legacy-representation evidence, not as current-layout tests.
    for(const name of ['salesInvoices','purchaseInvoices','stockMovements','auditLogs','customers','products','salesReturns','purchaseReturns','quotations','shifts','cashEntries','branchStocks']){
      const value=read(db,name);replace(name,'__partflow_chunked__');put(name+'#meta',{chunks:1,size:500,total:value.length});put(name+'#0000',value);
    }
  })();db.close();fs.writeFileSync(out,JSON.stringify({operation,source,sourceReadOnly:true,target,seed:'fresh canonical fixture, owner/settings from documented synthetic historical fixture; no customer database'},null,2));
}else if(operation==='inspect'){
  const db=new Database(target,{readonly:true,fileMustExist:true});db.pragma(`key="x'${key}'"`);
  const collections=Object.fromEntries(names.map(n=>[n,read(db,n)||[]]));
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pf_%'").all().map(x=>x.name);
  const projections=Object.fromEntries(tables.filter(n=>!['pf_catalog_search_fts','pf_catalog_search_fts_data','pf_catalog_search_fts_idx','pf_catalog_search_fts_content','pf_catalog_search_fts_docsize','pf_catalog_search_fts_config'].includes(n)).map(n=>[n,db.prepare('SELECT * FROM '+n).all()]));
  const defects=[];
  for(const [name,rows]of Object.entries(collections)){
    const ids=new Set();for(const r of rows){if(r.id&&ids.has(r.id))defects.push({type:'duplicate-id',name,id:r.id});ids.add(r.id);}
  }
  for(const r of collections.salesReturns)if(!collections.salesInvoices.some(x=>x.id===r.originalInvoiceId))defects.push({type:'orphan-sales-return',id:r.id});
  for(const r of collections.purchaseReturns)if(!collections.purchaseInvoices.some(x=>x.id===r.originalInvoiceId))defects.push({type:'orphan-purchase-return',id:r.id});
  fs.writeFileSync(out,JSON.stringify({path:target,readOnly:true,integrity:db.pragma('integrity_check'),settings:read(db,'settings'),collections,projections,defects},null,2));db.close();
}else throw Error('UNKNOWN_OPERATION');
