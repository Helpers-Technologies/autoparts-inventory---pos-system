import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {_electron} from '@playwright/test';
const require=createRequire(import.meta.url),electron=require('electron'),O=require('./fin-01-oracle.cjs');
const root=process.cwd(),work=path.join(root,'reports/financial-accounting-audit-2026-10');
const crashPurchase=process.argv.includes('--crash-purchase'),extraUi=process.argv.includes('--extra-ui');
const reviewIndex=process.argv.indexOf('--review-existing'),reviewExisting=reviewIndex>=0;
const output=reviewExisting?'desktop-financial-review-evidence.json':crashPurchase?'desktop-crash-evidence.json':extraUi?'fin-02-sale-evidence.json':'desktop-evidence.json';
const run=reviewExisting?path.dirname(path.resolve(process.argv[reviewIndex+1])):fs.mkdtempSync(path.join(work,'fin02-sale-')),db=reviewExisting?path.resolve(process.argv[reviewIndex+1]):path.join(run,'audit.sqlite');
if(!db.startsWith(work+path.sep))throw Error('FIN01_ISOLATED_PATH_REQUIRED');
const evidence=[];
function native(op,out){execFileSync(electron,[path.join(root,'scripts/fin-01-db.cjs'),op,db,path.join(run,out)],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:60000});return JSON.parse(fs.readFileSync(path.join(run,out),'utf8'));}
if(!reviewExisting)native('seed','seed.json');
let h;
async function launch(){
 const env={...process.env,HW_E2E:'1',HW_E2E_DB_PATH:db,NODE_ENV:'test',PARTFLOW_PHASE14_WORK_ROOT:work};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 const app=await _electron.launch({args:[path.join(root,'scripts/hardening-electron-bootstrap.cjs')],cwd:root,env,timeout:60000});h={app,page:await app.firstWindow()};
 const p=h.page;p.setDefaultTimeout(20000);
 await p.getByPlaceholder('Login username').waitFor({timeout:60000});await p.getByPlaceholder('Login username').fill('admin');await p.locator('input[type=password]').first().fill('stress123');await p.getByRole('button',{name:'تسجيل الدخول',exact:true}).click();
 await p.waitForFunction(()=>!location.hash.startsWith('#/login')&&!document.querySelector('input[placeholder="Login username"]'),{timeout:60000});
 const dismiss=p.getByRole('button',{name:'تمام، فهمت',exact:true});await dismiss.waitFor({state:'visible',timeout:3000}).catch(()=>{});if(await dismiss.isVisible())await dismiss.click();
 return p;
}
async function stop(forced=false){if(!h)return;if(forced){const pid=h.app.process().pid;execFileSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true});await h.app.waitForEvent('close',{timeout:15000}).catch(()=>{});}else await h.app.close();h=null;}
async function canonical(){return h.page.evaluate(async()=>{
 const result={},prefix='autoparts_inventory_v1::';
 for(const name of ['products','salesInvoices','purchaseInvoices','salesReturns','purchaseReturns','cashEntries','stockMovements','branchStocks','shifts','quotations']){
 const raw=await window.desktopAPI.storage.getCollection(name);let parsed=JSON.parse(raw[prefix+name]||'[]');if(parsed==='__partflow_chunked__'){const meta=JSON.parse(raw[prefix+name+'#meta']);parsed=Array.from({length:meta.chunks},(_,i)=>JSON.parse(raw[prefix+name+'#'+String(i).padStart(4,'0')])).flat();}result[name]=parsed;
 }return result;
 });}
async function durable(predicate){let state;for(let i=0;i<120;i++){state=await canonical();if(predicate(state))return state;await h.page.waitForTimeout(100);}throw Error('DURABILITY_PREDICATE_TIMEOUT');}
async function capture(id,expected={},extra={}){
 const c=await canonical(),p=h.page;
 const projection=await p.evaluate(async()=>({dashboard:await window.desktopAPI.storage.getDashboardSummary(),customer:await window.desktopAPI.query.statement('customer','fin-customer',{}),walkin:await window.desktopAPI.query.statement('customer','walkin',{}),supplier:await window.desktopAPI.query.statement('supplier','fin-supplier',{}),dues:await window.desktopAPI.query.duesParties({kind:'all'})}));
 if(projection.dashboard&&await p.evaluate(()=>location.hash==='#/'))await p.getByText(/جاري حساب المؤشرات المالية والتاريخية/).waitFor({state:'hidden',timeout:20000}).catch(()=>{});
 const actual={stock:c.products.find(x=>x.id==='fin-product').quantity,cash:10000+O.number(O.sum(c.cashEntries.map(x=>x.amount))),customer:O.number(O.sum(c.salesInvoices.filter(x=>x.customerId==='fin-customer'&&!x.cancelled&&!x.collectOnDelivery).map(x=>x.remaining-(x.overpayment||0)))),supplier:O.number(O.sum(c.purchaseInvoices.map(x=>x.remaining-(x.overpayment||0))))};
 const discrepancies=Object.keys(expected).filter(k=>!Number.isFinite(actual[k])||Math.abs(actual[k]-expected[k])>1e-7).map(field=>({field,expected:expected[field],actual:actual[field]}));
 if(projection.customer.error||projection.supplier.error||!projection.dashboard)discrepancies.push({field:'projection availability',expected:'financial queries available',actual:projection.customer.error||projection.supplier.error||'null dashboard'});
 else for(const field of ['customer','supplier'])if(Math.abs(actual[field]-projection[field].balance)>1e-7)discrepancies.push({field:'projection '+field,expected:actual[field],actual:projection[field].balance});
 await p.screenshot({path:path.join(run,id+'.png'),fullPage:true});
 const disk=native('inspect',id+'-native.json');
 const record={id,expected,actual,discrepancies,canonical:c,nativeSnapshot:path.join(run,id+'-native.json'),diskParity:Object.keys(c).every(k=>JSON.stringify(c[k])===JSON.stringify(disk.collections[k])),projection,ui:{route:await p.evaluate(()=>location.hash),text:await p.locator('body').innerText(),screenshot:path.join(run,id+'.png')},...extra};evidence.push(record);save();return record;
}
function save(){fs.writeFileSync(path.join(work,output),JSON.stringify({run,db,evidence},(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2)+'\n');}
try{
 let p=await launch();
 if(reviewExisting){
  for(const [id,route]of [['financial-reports','/reports/financial'],['customer-print-statement','/customers/fin-customer/statement'],['supplier-print-statement','/suppliers/fin-supplier/statement']]){
   await p.evaluate(r=>location.hash=r,route);await p.waitForTimeout(1500);await capture(id,{stock:1003,cash:9820,customer:-100,supplier:-80},{oracle:{salesNet:0,purchasesNet:200,profit:0},operation:'Read-only financial review UI; normal login audit only, no business action'});
  }throw Error('FIN01_EXPECTED_END');
 }
 await capture('initial',{stock:1000,cash:10000,customer:0,supplier:0});
 if(extraUi){
  await p.evaluate(()=>location.hash='/pos');await p.getByPlaceholder('ابحث عن منتج بالاسم أو الرمز...').waitFor();const floating=p.getByPlaceholder('مثال: 500');await floating.waitFor({state:'visible',timeout:3000}).catch(()=>{});if(await floating.isVisible()){await floating.fill('100');await p.getByRole('button',{name:/بدء الوردية الآن/}).click();}
  await p.getByPlaceholder('ابحث عن منتج بالاسم أو الرمز...').fill('FIN audit product');const tile=p.locator('[data-testid="pos-product-tile"]').filter({hasText:'FIN audit product'});await tile.click();await tile.click();
  await p.locator('[data-testid="pos-customer-select"]').getByRole('button').first().click();await p.getByPlaceholder('ابحث باسم العميل...').fill('FIN customer');await p.getByRole('button',{name:/FIN customer/}).last().click();
  await p.locator('label').filter({hasText:'الخصم'}).locator('input').fill('20');await p.locator('label').filter({hasText:'المدفوع'}).locator('input').fill('40');
  await p.getByRole('button',{name:/إتمام البيع/}).dblclick();await p.getByRole('button',{name:'عملية بيع جديدة',exact:true}).waitFor();let c=await durable(s=>s.salesInvoices.length===1);let inv=c.salesInvoices[0];
  await capture('ui-discount-partial-doubleclick',{stock:998,cash:10040,customer:140,supplier:0},{oracle:{total:180,discount:20,profit:80,invoiceCount:1}});
  throw Error('FIN01_EXPECTED_END');
 }

}catch(error){if(error.message!=='FIN01_EXPECTED_END'){evidence.push({id:'harness-error',error:String(error),stack:error.stack});save();if(h){await h.page.screenshot({path:path.join(run,'harness-error.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(run,'harness-error-ui.txt'),await h.page.locator('body').innerText().catch(()=>''));}process.exitCode=1;}}
finally{await stop().catch(()=>{});native('inspect','native-final.json');save();}

