import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {_electron} from '@playwright/test';
const require=createRequire(import.meta.url),electron=require('electron'),O=require('./fin-01-oracle.cjs');
const root=process.cwd(),work=path.join(root,'reports/financial-accounting-audit-2026-10');
const crashPurchase=process.argv.includes('--crash-purchase'),extraUi=process.argv.includes('--extra-ui');
const reviewIndex=process.argv.indexOf('--review-existing'),reviewExisting=reviewIndex>=0;
const output=reviewExisting?'desktop-financial-review-evidence.json':crashPurchase?'desktop-crash-evidence.json':extraUi?'desktop-extra-evidence.json':'desktop-evidence.json';
const run=reviewExisting?path.dirname(path.resolve(process.argv[reviewIndex+1])):fs.mkdtempSync(path.join(work,'desktop-')),db=reviewExisting?path.resolve(process.argv[reviewIndex+1]):path.join(run,'audit.sqlite');
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
  await p.evaluate(id=>location.hash='/sales/'+id,inv.id);await p.getByRole('button',{name:'تسجيل دفعة',exact:true}).click();let dialog=p.getByRole('dialog');await dialog.locator('input[type=number]').fill('60');await dialog.getByRole('button',{name:'تسجيل',exact:true}).click();await durable(s=>s.salesInvoices[0].amountReceived===100);
  await capture('ui-customer-partial-payment',{stock:998,cash:10100,customer:80,supplier:0});
  await p.getByRole('button',{name:/مرتجع/}).first().click();dialog=p.getByRole('dialog');await dialog.locator('input[type=number]').fill('2');await dialog.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();await p.getByText('قيمة المرتجع تتجاوز المتبقي من الفاتورة',{exact:true}).waitFor();
  await capture('ui-discount-full-return-blocked',{stock:998,cash:10100,customer:80,supplier:0},{oracle:{fullReturnNet:180,fullReturnQuantity:2},note:'Full gross return 200 is blocked against discounted net 180; documented supported UI limitation.'});
  await dialog.locator('input[type=number]').fill('1');await dialog.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();await durable(s=>s.salesReturns.length===1);
  await capture('ui-discount-partial-credit-return',{stock:999,cash:10100,customer:-20,supplier:0},{oracle:{effectiveTotal:80,retainedCredit:20}});
  await stop();p=await launch();await capture('ui-extra-restart',{stock:999,cash:10100,customer:-20,supplier:0});
  await p.evaluate(()=>location.hash='/pos');await p.getByPlaceholder('ابحث عن منتج بالاسم أو الرمز...').waitFor();await p.getByPlaceholder('ابحث عن منتج بالاسم أو الرمز...').fill('FIN audit product');await p.locator('[data-testid="pos-product-tile"]').filter({hasText:'FIN audit product'}).click();
  await p.locator('[data-testid="pos-customer-select"]').getByRole('button').first().click();await p.getByPlaceholder('ابحث باسم العميل...').fill('FIN customer');await p.getByRole('button',{name:/FIN customer/}).last().click();await p.getByRole('button',{name:'بطاقة',exact:true}).click();
  await p.getByRole('button',{name:/إتمام البيع/}).click();await p.getByRole('button',{name:'عملية بيع جديدة',exact:true}).waitFor();c=await durable(s=>s.salesInvoices.length===2);inv=c.salesInvoices.find(x=>x.id!==inv.id);
  await capture('ui-card-sale',{stock:998,cash:10200,customer:-20,supplier:0},{oracle:{physicalCashDelta:0,cardDelta:100}});
  await p.evaluate(id=>location.hash='/sales/'+id,inv.id);await p.getByRole('button',{name:/مرتجع/}).first().click();dialog=p.getByRole('dialog');await dialog.locator('input[type=number]').fill('1');await dialog.locator('input[type=checkbox]').check();await dialog.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();await durable(s=>s.salesReturns.length===2);
  await capture('ui-card-sale-cash-refund',{stock:999,cash:10100,customer:-20,supplier:0},{oracle:{physicalRefund:100,cardRetained:100,netSales:80,profit:30}});
  await p.evaluate(()=>location.hash='/pos');await p.getByRole('button',{name:'إغلاق الوردية',exact:true}).click();dialog=p.getByRole('dialog');fs.writeFileSync(path.join(run,'shift-close-ui.txt'),await dialog.innerText());await dialog.locator('input').first().fill('100');await dialog.getByRole('button',{name:/تأكيد الإغلاق|تقفيل الوردية|إغلاق الوردية/}).last().click();await durable(s=>s.shifts[0].status==='closed');await capture('ui-shift-closed',{stock:999,cash:10100,customer:-20,supplier:0},{oracle:{openingDrawer:100,physicalReceipts:100,physicalRefunds:100,closingDrawer:100,difference:0}});
  throw Error('FIN01_EXPECTED_END');
 }
 await p.evaluate(()=>location.hash='/purchases/new');await p.getByRole('button',{name:'إضافة بند',exact:true}).first().waitFor();
 fs.writeFileSync(path.join(run,'purchase-ui.txt'),await p.locator('body').innerText());
 await p.getByRole('button',{name:'إضافة بند',exact:true}).first().click();
 fs.writeFileSync(path.join(run,'purchase-dom.json'),JSON.stringify(await p.locator('input,select,button').evaluateAll(els=>els.map(e=>({tag:e.tagName,type:e.type,text:e.innerText,placeholder:e.placeholder,aria:e.getAttribute('aria-label'),value:e.value}))),null,2));
 await capture('purchase-form');
 await p.getByRole('button',{name:/اختر منتجاً أو ابحث/}).click();await p.getByRole('button',{name:/FIN audit product المتاح/}).click();
 await p.locator('tbody input[type=number]').nth(0).fill('3');await p.locator('tbody input[type=number]').nth(1).fill('60');
 await p.getByRole('button',{name:'إضافة بند',exact:true}).click();await p.getByRole('button',{name:/اختر منتجاً أو ابحث/}).click();await p.getByRole('button',{name:/FIN audit product المتاح/}).click();
 await p.locator('tbody input[type=number]').nth(2).fill('2');await p.locator('tbody input[type=number]').nth(3).fill('80');
 await p.getByLabel('فرع الاستلام',{exact:true}).selectOption('fin-other');
 await p.locator('input[type=number]').last().fill('100');await p.getByRole('button',{name:'حفظ الفاتورة',exact:true}).first().click();
 if(crashPurchase){
  const route=await p.evaluate(()=>location.hash);await stop(true);const interrupted=native('inspect','interrupted-purchase.json');evidence.push({id:'purchase-forced-stop-after-ui-success',uiSuccessRoute:route,expected:{invoiceCount:1,stock:1005,cash:9900,supplier:240},canonical:interrupted.collections,nativeSnapshot:path.join(run,'interrupted-purchase.json'),note:'Forced process termination immediately after real UI save click, before durability polling.'});save();p=await launch();await capture('purchase-crash-restart',{stock:1005,cash:9900,supplier:240});throw Error('FIN01_EXPECTED_END');
 }
 let c=await durable(s=>s.purchaseInvoices.length===1),purchase=c.purchaseInvoices[0];
 await capture('purchase-partial-repeated-other',{stock:1005,cash:9900,supplier:240},{oracle:{total:340,averageCost:50340/1005,branch:{main:600,other:405}}});
 await p.getByRole('button',{name:/مرتجع/}).first().click();let dialog=p.getByRole('dialog');await dialog.locator('input[type=number]').first().fill('1');await dialog.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();
 await durable(s=>s.purchaseReturns.length===1);await capture('purchase-return-other',{stock:1004,cash:9900,supplier:180},{oracle:{total:280,averageCost:50280/1004,branch:{main:600,other:404}}});
 await p.getByRole('button',{name:/تسجيل دفعة|سداد|دفعة/}).first().click();dialog=p.getByRole('dialog');await dialog.locator('input[type=number]').fill('180');
 fs.writeFileSync(path.join(run,'purchase-payment-ui.txt'),await dialog.innerText());
 await dialog.getByRole('button',{name:/تسجيل|حفظ|سداد/}).click();await durable(s=>s.purchaseInvoices[0].remaining===0);
 await capture('purchase-settlement',{stock:1004,cash:9720,supplier:0});
 await p.getByRole('button',{name:/مرتجع/}).first().click();dialog=p.getByRole('dialog');await dialog.locator('input[type=number]').nth(1).fill('1');await dialog.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();
 await durable(s=>s.purchaseReturns.length===2);await capture('purchase-paid-return-credit',{stock:1003,cash:9720,supplier:-80},{oracle:{total:200,averageCost:50200/1003}});
 await stop();p=await launch();await capture('purchase-restart-recovered-queries',{stock:1003,cash:9720,supplier:-80});
 await p.evaluate(()=>location.hash='/pos');await p.getByPlaceholder('ابحث عن منتج بالاسم أو الرمز...').waitFor();
 const floating=p.getByPlaceholder('مثال: 500');await floating.waitFor({state:'visible',timeout:3000}).catch(()=>{});if(await floating.isVisible()){await floating.fill('100');await p.getByRole('button',{name:/بدء الوردية الآن/}).click();}
 const search=p.getByPlaceholder('ابحث عن منتج بالاسم أو الرمز...');await search.fill('FIN audit product');await p.locator('[data-testid="pos-product-tile"]').filter({hasText:'FIN audit product'}).click();
 await p.locator('[data-testid="pos-customer-select"]').getByRole('button').first().click();await p.getByPlaceholder('ابحث باسم العميل...').fill('FIN customer');await p.getByRole('button',{name:/FIN customer/}).last().click();
 await p.getByRole('button',{name:/إتمام البيع/}).click();await p.getByRole('button',{name:'عملية بيع جديدة',exact:true}).waitFor();
 c=await durable(s=>s.salesInvoices.length===1);const sold=c.salesInvoices[0];
 await capture('pos-cash-sale',{stock:1002,cash:9820,supplier:-80},{oracle:{invoiceTotal:100,cost:50200/1003,profit:100-50200/1003}});
 await p.evaluate(id=>location.hash='/sales/'+id,sold.id);await p.getByRole('button',{name:/مرتجع/}).first().click();dialog=p.getByRole('dialog');await dialog.locator('input[type=number]').first().fill('1');await dialog.getByRole('button',{name:'اعتماد المرتجع',exact:true}).click();
 await durable(s=>s.salesReturns.length===1);await capture('pos-paid-return-credit',{stock:1003,cash:9820,supplier:-80},{oracle:{profit:0,stock:1003,retainedCustomerCredit:100}});
 await stop();p=await launch();await capture('sales-return-restart-recovered-queries',{stock:1003,cash:9820,customer:-100,supplier:-80},{oracle:{profit:0}});
 for(const [id,route]of [['customer-detail','/customers/'+sold.customerId],['supplier-detail','/suppliers/fin-supplier'],['cashbox','/cashbox'],['dues','/dues'],['reports','/reports'],['dashboard','/']]){
  await p.evaluate(r=>location.hash=r,route);await p.waitForTimeout(600);await capture(id,{stock:1003,cash:9820,supplier:-80},{oracle:{profit:0,salesNet:0,purchasesNet:200}});
 }
 const before=await canonical();await stop(true);await launch();await capture('forced-restart-after-durable',{stock:1003,cash:9820,supplier:-80},{before,operation:'Forced kill after confirmed durable state, not midtransaction'});
}catch(error){if(error.message!=='FIN01_EXPECTED_END'){evidence.push({id:'harness-error',error:String(error),stack:error.stack});save();if(h){await h.page.screenshot({path:path.join(run,'harness-error.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(run,'harness-error-ui.txt'),await h.page.locator('body').innerText().catch(()=>''));}process.exitCode=1;}}
finally{await stop().catch(()=>{});native('inspect','native-final.json');save();}

