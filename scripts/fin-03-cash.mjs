// FIN-03 observation harness. Findings never become passing checks via a tolerance.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {_electron} from '@playwright/test';
const require=createRequire(import.meta.url), electron=require('electron'), O=require('./fin-01-oracle.cjs');
const root=process.cwd(), reports=path.join(root,'reports/financial-accounting-audit-2026-10');
const work='C:/Users/amrha/.codex/artifacts/fin-03-2026-10-03';
fs.mkdirSync(work,{recursive:true});
const run=fs.mkdtempSync(path.join(work,'precision-')), db=path.join(run,'audit.sqlite');
const results=[]; let app,page;
const save=()=>fs.writeFileSync(path.join(reports,'fin-03-cash-desktop-evidence.json'),JSON.stringify({run,db,results},(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2));
function native(op,name){const out=path.join(run,name+'.json');execFileSync(electron,[path.join(root,'scripts/fin-03-db.cjs'),op,db,out],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:60000});return JSON.parse(fs.readFileSync(out,'utf8'));}
async function launch(){const env={...process.env,HW_E2E:'1',HW_E2E_DB_PATH:db,NODE_ENV:'test',PARTFLOW_PHASE14_WORK_ROOT:work};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;app=await _electron.launch({args:[path.join(root,'scripts/hardening-electron-bootstrap.cjs')],cwd:root,env,timeout:60000});page=await app.firstWindow();page.setDefaultTimeout(20000);await page.getByPlaceholder('Login username').waitFor({timeout:60000});await page.getByPlaceholder('Login username').fill('admin');await page.locator('input[type=password]').first().fill('stress123');await page.getByRole('button',{name:'\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('input[placeholder="Login username"]'));const dismiss=page.getByRole('button',{name:'\u062a\u0645\u0627\u0645\u060c \u0641\u0647\u0645\u062a',exact:true});await dismiss.waitFor({state:'visible',timeout:2000}).catch(()=>{});if(await dismiss.isVisible())await dismiss.click();}
async function stop(){if(!app)return;await app.close();app=null;}
async function canonical(){return page.evaluate(async()=>{const c={},prefix='autoparts_inventory_v1::';for(const name of ['products','purchaseInvoices','salesInvoices','cashEntries','stockMovements','branchStocks','salesReturns','purchaseReturns']){const raw=await window.desktopAPI.storage.getCollection(name);let value=JSON.parse(raw[prefix+name]||'[]');if(value==='__partflow_chunked__'){const meta=JSON.parse(raw[prefix+name+'#meta']);value=Array.from({length:meta.chunks},(_,i)=>JSON.parse(raw[prefix+name+'#'+String(i).padStart(4,'0')])).flat();}c[name]=value;}return c;});}
async function projection(){return page.evaluate(async()=>({dashboard:await window.desktopAPI.storage.getDashboardSummary(),supplier:await window.desktopAPI.query.statement('supplier','fin-supplier',{}),customer:await window.desktopAPI.query.statement('customer','fin-customer',{})}));}
function command(api,price=0.1,quantity=3,paid=0,patch={}){return {invoice:{invoiceNumber:'FIN03-'+results.length,date:'2026-10-03',supplierId:'fin-supplier',supplierName:'FIN supplier',customerId:'fin-customer',customerName:'FIN customer',branchId:'fin-other',lines:[{id:'line',productId:'fin-product',quantity,price,subtotal:price*quantity}],total:price*quantity,[api==='purchases'?'amountPaid':'amountReceived']:paid,paymentType:'account',priceType:'retail',...patch}};}
const eq=(a,b)=>{const r=O.rational(a);return r.n*b.d===b.n*r.d;};
async function execute(id,api,c,expectedAccepted=true){const before=await canonical();const response=await page.evaluate(({api,c})=>window.desktopAPI[api].create(c),{api,c});const after=await canonical();const unchanged=JSON.stringify(before)===JSON.stringify(after);const record={id,api,input:c,response,expectedAccepted,invalidStateUnchanged:unchanged,validationPass:response.ok===expectedAccepted&&(expectedAccepted||unchanged)};if(response.ok){const invoice=response.invoice, exact=O.invoice(c.invoice.lines,c.invoice.discount||0,c.invoice.shippingFee||0);record.exactTotal=O.exact(exact);record.canonicalTotal=invoice.total;record.exactTotalMatches=eq(invoice.total,exact);record.canonicalInvoice=after[api==='purchases'?'purchaseInvoices':'salesInvoices'].find(x=>x.id===invoice.id);record.serializationMatches=JSON.stringify(invoice)===JSON.stringify(record.canonicalInvoice);record.display=invoice.total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});record.projection=await projection();record.stock=after.products[0].quantity;record.cashEntries=after.cashEntries.map(x=>({id:x.id,amount:x.amount}));}results.push(record);save();return record;}
try{
 native('seed','seed');await launch();await page.waitForTimeout(2500);
 let entries=[];
 for(const [amount,count]of [[0.01,100],[0.01,1000],[0.001,1000],[0.333,300],[0.005,1000],[-0.333,300]]){
  for(let i=0;i<count;i++)entries.push({id:'cash-'+entries.length,type:'adjustment',amount,date:'2026-10-03',description:'FIN03 repeated cash',paymentMethod:'cash'});
  const prefix='autoparts_inventory_v1::cashEntries',chunks=Math.ceil(entries.length/500),rows={[prefix]:JSON.stringify('__partflow_chunked__'),[prefix+'#meta']:JSON.stringify({chunks,size:500,total:entries.length})};
  for(let i=0;i<chunks;i++)rows[prefix+'#'+String(i).padStart(4,'0')]=JSON.stringify(entries.slice(i*500,(i+1)*500));
  const accepted=await page.evaluate(rows=>window.desktopAPI.storage.setBatch(rows),rows),after=await canonical(),projected=await projection();
  const expected=O.add(O.rational(10000),O.sum(entries.map(x=>x.amount)));
  const actual=projected.dashboard?.stats?.cashBalance;
  results.push({id:'accumulation-'+amount+'-'+count,accepted,count,amount,entries:entries.length,exactExpected:O.exact(expected),actual,exactProjectionMatches:Number.isFinite(actual)&&eq(actual,expected),canonicalEntriesMatches:JSON.stringify(after.cashEntries)===JSON.stringify(entries),projection:projected});save();
 }
 const before=native('inspect','before-restart');await stop();await launch();const after=native('inspect','after-restart');results.push({id:'restart',businessPass:Object.entries(before.collections).filter(([k])=>k!=='auditLogs').every(([k,v])=>JSON.stringify(v)===JSON.stringify(after.collections[k])),integrity:after.integrity,snapshot:path.join(run,'after-restart.json')});save();
 for(const [id,route]of [['cashbox','/cashbox'],['report','/reports/financial']]){await page.evaluate(r=>location.hash=r,route);await page.waitForTimeout(1500);const screenshot=path.join(run,id+'.png');await page.screenshot({path:screenshot,fullPage:true});results.push({id,text:await page.locator('body').innerText(),screenshot});save();}
}catch(error){results.push({id:'harness-error',error:String(error),stack:error.stack});save();process.exitCode=1;}finally{await stop();save();}
