import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {_electron} from '@playwright/test';
const require=createRequire(import.meta.url),electron=require('electron'),O=require('./fin-01-oracle.cjs');
const root=process.cwd(),work=path.join(root,'reports/financial-accounting-audit-2026-10'),run=fs.mkdtempSync(path.join(work,'ipc-')),db=path.join(run,'audit.sqlite'),evidence=[];
const native=(op,out)=>{execFileSync(electron,[path.join(root,'scripts/fin-01-db.cjs'),op,db,path.join(run,out)],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:60000});return JSON.parse(fs.readFileSync(path.join(run,out),'utf8'));};
native('seed','seed.json');let app,page;
const save=()=>fs.writeFileSync(path.join(work,'ipc-evidence.json'),JSON.stringify({run,db,evidence},(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2)+'\n');
async function launch(){const env={...process.env,HW_E2E:'1',HW_E2E_DB_PATH:db,NODE_ENV:'test',PARTFLOW_PHASE14_WORK_ROOT:work};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;app=await _electron.launch({args:[path.join(root,'scripts/hardening-electron-bootstrap.cjs')],cwd:root,env,timeout:60000});page=await app.firstWindow();page.setDefaultTimeout(20000);await page.getByPlaceholder('Login username').waitFor({timeout:60000});await page.getByPlaceholder('Login username').fill('admin');await page.locator('input[type=password]').first().fill('stress123');await page.getByRole('button',{name:'تسجيل الدخول',exact:true}).click();await page.waitForFunction(()=>!location.hash.startsWith('#/login')&&!document.querySelector('input[placeholder="Login username"]'),{timeout:60000});}
const digest=collections=>require('node:crypto').createHash('sha256').update(JSON.stringify(collections)).digest('hex');
const cashSum=rows=>rows.some(x=>typeof x.amount!=='number'||!Number.isFinite(x.amount))?NaN:O.number(O.sum(rows.map(x=>x.amount)));
const line=(q=1,p=100)=>({id:'L1',productId:'fin-product',productName:'FIN audit product',unit:'unit',quantity:q,price:p,subtotal:q*p});
let seq=0;
function command(patch={},other={}){return {invoiceId:'fin-ipc-'+(++seq),invoice:{date:'2026-10-03',customerId:'fin-customer',customerName:'FIN customer',lines:[line()],total:100,amountReceived:100,paymentType:'cash',paymentMethod:'cash',priceType:'wholesale',branchId:'fin-main',...patch},...other};}
async function test(id,cmd,expectedAccepted,oracle={}){
 const before=native('inspect',id+'-before.json');
 const response=await page.evaluate(c=>window.desktopAPI.sales.create(c),cmd);
 const after=native('inspect',id+'-after.json');
 const expected={accepted:expectedAccepted,...oracle},actual={accepted:response.ok};
 if(response.ok){const inv=after.collections.salesInvoices.find(x=>x.id===cmd.invoiceId);Object.assign(actual,{total:inv.total,paid:inv.amountReceived,remaining:inv.remaining,credit:inv.overpayment||0,cashDelta:cashSum(after.collections.cashEntries)-cashSum(before.collections.cashEntries),stockDelta:after.collections.products[0].quantity-before.collections.products[0].quantity});}
 const discrepancies=Object.keys(expected).filter(k=>typeof expected[k]==='number'?!Number.isFinite(actual[k])||Math.abs(expected[k]-actual[k])>1e-7:expected[k]!==actual[k]).map(field=>({field,expected:expected[field],actual:actual[field]}));
 if(!response.ok&&digest(before.collections)!==digest(after.collections))discrepancies.push({field:'failed transaction canonical rollback',expected:'unchanged',actual:'changed'});
 evidence.push({id,layer:'actual authenticated desktop IPC, encrypted SQLite before/after, query projections',input:cmd,response,expected,actual,discrepancies,canonicalUnchanged:digest(before.collections)===digest(after.collections),nativeBefore:path.join(run,id+'-before.json'),nativeAfter:path.join(run,id+'-after.json')});save();return response;
}
try{
 await launch();
 for(const [id,patch]of [
  ['negative-price',{lines:[line(1,-100)],total:-100}],['negative-quantity',{lines:[line(-1,100)],total:-100}],['zero-quantity',{lines:[line(0,100)],total:0}],['nan-price',{lines:[line(1,NaN)]}],['infinite-quantity',{lines:[line(Infinity,100)]}],['unknown-product',{lines:[{...line(),productId:'unknown'}]}],['unknown-customer',{customerId:'unknown'}],['unknown-branch',{branchId:'unknown'}],['insufficient-global',{lines:[line(2000)],total:200000}],['insufficient-branch',{lines:[line(700)],total:70000}],['negative-discount',{discount:-1,total:101}],['excess-discount',{discount:101,total:-1}],['mismatched-total',{total:105}],
 ])await test(id,command(patch),false);
 for(const stage of ['before_sale_persistence','after_sale_record','during_stock_update','before_cash_update','after_cash_update','before_projection','before_commit'])await test('atomic-'+stage,command({}, {failureStage:stage}),false);
 for(const price of [0,0.001,0.01,0.1,0.3,0.333,1.001,999.999,999999.99,90071992547409.9]){
  const q=0.333,net=O.invoice([{quantity:q,price}]),total=O.number(net);
  await test('precision-'+price,command({lines:[line(q,price)],total,amountReceived:total}),true,{total,paid:total,remaining:0,credit:0,cashDelta:total,stockDelta:-q});
 }
 await test('partial-sale',command({amountReceived:40,paymentType:'account'}),true,{total:100,paid:40,remaining:60,credit:0,cashDelta:40,stockDelta:-1});
 await test('explicit-overpayment',command({amountReceived:100,overpayment:50}),true,{total:100,paid:100,remaining:0,credit:50,cashDelta:150,stockDelta:-1});
 await test('unsplit-overpayment',command({amountReceived:150}),true,{total:100,paid:100,remaining:0,credit:50,cashDelta:150,stockDelta:-1});
 await test('cod',command({amountReceived:100,collectOnDelivery:true,paymentType:'account'}),true,{total:100,paid:0,remaining:100,credit:0,cashDelta:0,stockDelta:-1});
 const dup=command();await test('duplicate-first',dup,true,{total:100,paid:100,remaining:0,credit:0,cashDelta:100,stockDelta:-1});await test('duplicate-retry-same-id',dup,false);
 const base=native('inspect','concurrent-before.json');const cmds=[command(),command()];
 const responses=await page.evaluate(async cs=>Promise.all(cs.map(c=>window.desktopAPI.sales.create(c))),cmds);const post=native('inspect','concurrent-after.json');
 evidence.push({id:'two-distinct-concurrent-commands',inputs:cmds,responses,expected:'Two different operation identifiers represent two legitimate sales; UI guard audited separately',delta:{invoices:post.collections.salesInvoices.length-base.collections.salesInvoices.length,cash:O.number(O.sum(post.collections.cashEntries.map(x=>x.amount)))-O.number(O.sum(base.collections.cashEntries.map(x=>x.amount)))}});save();
 // Dangerous numeric cases last, preserving polluted isolated fixtures as reproduction.
 await test('nonfinite-cost-snapshot',command({lines:[{...line(),costPrice:NaN}]}),false);
 await test('infinite-received',command({amountReceived:Infinity}),false);
 await test('infinite-shipping-total',command({shippingFee:Infinity,total:Infinity,amountReceived:0}),false);
 // Stop without giving deliberately stale renderer data a chance to flush.
 const pid=app.process().pid;execFileSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true});await app.waitForEvent('close',{timeout:15000}).catch(()=>{});app=null;
 const persisted=native('inspect','after-forced-stop.json');evidence.push({id:'forced-stop-after-ipc-durable',native:path.join(run,'after-forced-stop.json'),integrity:persisted.integrity});save();
 await launch();const restarted=native('inspect','after-restart.json');evidence.push({id:'restart-canonical-parity',expected:true,actual:digest(persisted.collections)===digest(restarted.collections),note:'Includes deliberately malformed numeric records; compare preserved financial collections; login audit may differ'});save();
}catch(error){evidence.push({id:'harness-error',error:String(error),stack:error.stack});save();process.exitCode=1;}
finally{if(app){const pid=app.process().pid;execFileSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true});await app.waitForEvent('close',{timeout:15000}).catch(()=>{});}save();}
