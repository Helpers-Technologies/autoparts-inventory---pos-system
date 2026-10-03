import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {_electron} from '@playwright/test';
const require=createRequire(import.meta.url),electron=require('electron'),O=require('./fin-01-oracle.cjs');
const root=process.cwd(),reports=path.join(root,'reports/financial-accounting-audit-2026-10'),work='C:/Users/amrha/.codex/artifacts/fin-03-2026-10-03';fs.mkdirSync(work,{recursive:true});
const run=fs.mkdtempSync(path.join(work,'fin03-ui-')), results=[];
let app,page,db;
const save=()=>fs.writeFileSync(path.join(reports,'fin-03-ui-evidence.json'),JSON.stringify({run,results},(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2));
function native(op,name){const out=path.join(path.dirname(db),name+'.json');execFileSync(electron,[path.join(root,'scripts/fin-03-db.cjs'),op,db,out],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:60000});return JSON.parse(fs.readFileSync(out,'utf8'));}
async function launch(stage){const env={...process.env,HW_E2E:'1',HW_E2E_DB_PATH:db,NODE_ENV:'test',PARTFLOW_PHASE14_WORK_ROOT:work,PARTFLOW_FIN02_KILL_STAGE:stage||'',PARTFLOW_FIN02_MARKER:path.join(path.dirname(db),'marker')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;app=await _electron.launch({args:[path.join(root,'scripts/hardening-electron-bootstrap.cjs')],cwd:root,env,timeout:60000});app.process().stderr.on("data", data=>fs.appendFileSync(path.join(path.dirname(db),"electron-stderr.txt"),data));page=await app.firstWindow();page.on("pageerror",error=>fs.appendFileSync(path.join(path.dirname(db),"renderer-error.txt"),String(error)));page.on("console",msg=>fs.appendFileSync(path.join(path.dirname(db),"renderer-console.txt"),msg.text()+"\n"));page.setDefaultTimeout(20000);await page.getByPlaceholder('Login username').waitFor({timeout:60000});await page.getByPlaceholder('Login username').fill('admin');await page.locator('input[type=password]').first().fill('stress123');await page.getByRole('button',{name:'\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('input[placeholder="Login username"]'),{timeout:60000});const dismiss=page.getByRole('button',{name:'\u062a\u0645\u0627\u0645\u060c \u0641\u0647\u0645\u062a',exact:true});await dismiss.waitFor({state:'visible',timeout:2000}).catch(()=>{});if(await dismiss.isVisible())await dismiss.click();}
async function stop(){if(!app)return;execFileSync('taskkill.exe',['/PID',String(app.process().pid),'/T','/F'],{windowsHide:true});await app.waitForEvent('close',{timeout:15000}).catch(()=>{});app=null;}
function fixture(name){const dir=path.join(run,name);fs.mkdirSync(dir);db=path.join(dir,'audit.sqlite');return native('seed','seed');}
function state(snapshot){const c=snapshot.collections;const inv=c.purchaseInvoices;return {invoices:inv.length,lines:inv.reduce((n,i)=>n+i.lines.length,0),stock:c.products[0].quantity,avgCost:c.products[0].avgCost,purchasePrice:c.products[0].purchasePrice,branch:c.branchStocks.find(s=>s.branchId==='fin-other'&&s.productId==='fin-product')?.quantity,ledger:c.stockMovements.filter(s=>s.referenceType==='purchase').length,cash:10000+O.number(O.sum(c.cashEntries.map(s=>s.amount))),supplier:O.number(O.sum(inv.flatMap(i=>[i.remaining,-(i.overpayment||0)])))};}
const same=(a,b)=>JSON.stringify(Object.fromEntries(Object.entries(a.collections).filter(([key])=>key!=='auditLogs')))===JSON.stringify(Object.fromEntries(Object.entries(b.collections).filter(([key])=>key!=='auditLogs')));
function command(patch={},other={}){return {invoice:{invoiceNumber:'FIN02-P',date:'2026-10-03',supplierId:'fin-supplier',supplierName:'FIN supplier',branchId:'fin-other',lines:[{id:'l1',productId:'fin-product',quantity:3,price:60,subtotal:180},{id:'l2',productId:'fin-product',quantity:2,price:80,subtotal:160}],total:340,amountPaid:100,...patch},...other};}
async function form(){ await page.evaluate(()=>location.hash='/purchases/new');await page.getByRole('button',{name:'\u0625\u0636\u0627\u0641\u0629 \u0628\u0646\u062f',exact:true}).first().waitFor();
 await page.getByRole('button',{name:'\u0625\u0636\u0627\u0641\u0629 \u0628\u0646\u062f',exact:true}).first().click();

 await page.getByRole('button',{name:/\u0627\u062e\u062a\u0631 \u0645\u0646\u062a\u062c\u0627\u064b \u0623\u0648 \u0627\u0628\u062d\u062b/}).click();await page.getByRole('button',{name:/FIN audit product \u0627\u0644\u0645\u062a\u0627\u062d/}).click();
 await page.locator('tbody input[type=number]').nth(0).fill('3');await page.locator('tbody input[type=number]').nth(1).fill('60');
 await page.getByRole('button',{name:'\u0625\u0636\u0627\u0641\u0629 \u0628\u0646\u062f',exact:true}).click();await page.getByRole('button',{name:/\u0627\u062e\u062a\u0631 \u0645\u0646\u062a\u062c\u0627\u064b \u0623\u0648 \u0627\u0628\u062d\u062b/}).click();await page.getByRole('button',{name:/FIN audit product \u0627\u0644\u0645\u062a\u0627\u062d/}).click();
 await page.locator('tbody input[type=number]').nth(2).fill('2');await page.locator('tbody input[type=number]').nth(3).fill('80');
 await page.getByLabel('\u0641\u0631\u0639 \u0627\u0644\u0627\u0633\u062a\u0644\u0627\u0645',{exact:true}).selectOption('fin-other');
 await page.locator('input[type=number]').last().fill('100');}

try{
 fixture('purchase-ui');await launch();
 for(const [id,q,p,paid,accepted]of [['zero-price',1,0,0,true],['tiny-price',1,0.001,0,true],['repeated-decimal',3,0.1,0.1,true],['fractional-quantity',0.333,10.005,0.01,true],['large-price',1,1e18,0,true],['negative-price',1,-1,0,false],['zero-quantity',0,1,0,false],['negative-quantity',-1,1,0,false],['overflow',10,1e308,0,false]]){
  await page.evaluate(()=>location.hash='/');await page.waitForTimeout(100);await form();
  await page.locator('tbody input[type=number]').nth(0).fill(String(q));await page.locator('tbody input[type=number]').nth(1).fill(String(p));
  await page.locator('tbody input[type=number]').nth(2).fill('1');await page.locator('tbody input[type=number]').nth(3).fill('0');await page.locator('input[type=number]').last().fill(String(paid));
  const before=native('inspect',id+'-before'),preText=await page.locator('body').innerText();await page.screenshot({path:path.join(path.dirname(db),id+'-input.png')});
  await page.getByRole('button',{name:'\u062d\u0641\u0638 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629',exact:true}).first().click();
  if(accepted)await page.waitForFunction(()=>location.hash!=='#/purchases/new'&&location.hash.startsWith('#/purchases/'));else await page.waitForTimeout(300);
  const after=native('inspect',id+'-after'),invoice=after.collections.purchaseInvoices.find(x=>!before.collections.purchaseInvoices.some(b=>b.id===x.id));
  results.push({id,layer:'real Electron purchase UI',input:{q,p,paid},expectedAccepted:accepted,invoice,canonicalUnchanged:same(before,after),validationPass:accepted?!!invoice:same(before,after),oracleExactTotal:O.exact(O.invoice([{quantity:q,price:p}])),preText,text:await page.locator('body').innerText(),screenshot:path.join(path.dirname(db),id+'-input.png'),snapshot:path.join(path.dirname(db),id+'-after.json')});save();
 }
}catch(error){results.push({id:'harness-error',error:String(error),stack:error.stack});if(page){fs.writeFileSync(path.join(path.dirname(db),'error-ui.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(path.dirname(db),'error.png')}).catch(()=>{});}save();process.exitCode=1;}finally{await stop();save();}
