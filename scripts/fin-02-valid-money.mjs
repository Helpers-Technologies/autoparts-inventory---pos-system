import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {_electron} from '@playwright/test';
const require=createRequire(import.meta.url),electron=require('electron'),O=require('./fin-01-oracle.cjs');
const root=process.cwd(),work=path.join(root,'reports/financial-accounting-audit-2026-10');
const run=fs.mkdtempSync(path.join(work,'fin02-desktop-')), results=[];
let app,page,db;
const save=()=>fs.writeFileSync(path.join(work,'fin-02-valid-money-evidence.json'),JSON.stringify({run,results},(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2));
function native(op,name){const out=path.join(path.dirname(db),name+'.json');execFileSync(electron,[path.join(root,'scripts/fin-01-db.cjs'),op,db,out],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:60000});return JSON.parse(fs.readFileSync(out,'utf8'));}
async function launch(stage){const env={...process.env,HW_E2E:'1',HW_E2E_DB_PATH:db,NODE_ENV:'test',PARTFLOW_PHASE14_WORK_ROOT:work,PARTFLOW_FIN02_KILL_STAGE:stage||'',PARTFLOW_FIN02_MARKER:path.join(path.dirname(db),'marker')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;app=await _electron.launch({args:[path.join(root,'scripts/hardening-electron-bootstrap.cjs')],cwd:root,env,timeout:60000});app.process().stderr.on("data", data=>fs.appendFileSync(path.join(path.dirname(db),"electron-stderr.txt"),data));page=await app.firstWindow();page.on("pageerror",error=>fs.appendFileSync(path.join(path.dirname(db),"renderer-error.txt"),String(error)));page.on("console",msg=>fs.appendFileSync(path.join(path.dirname(db),"renderer-console.txt"),msg.text()+"\n"));page.setDefaultTimeout(20000);await page.getByPlaceholder('Login username').waitFor({timeout:60000});await page.getByPlaceholder('Login username').fill('admin');await page.locator('input[type=password]').first().fill('stress123');await page.getByRole('button',{name:'\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('input[placeholder="Login username"]'),{timeout:60000});const dismiss=page.getByRole('button',{name:'\u062a\u0645\u0627\u0645\u060c \u0641\u0647\u0645\u062a',exact:true});await dismiss.waitFor({state:'visible',timeout:2000}).catch(()=>{});if(await dismiss.isVisible())await dismiss.click();}
async function stop(){if(!app)return;execFileSync('taskkill.exe',['/PID',String(app.process().pid),'/T','/F'],{windowsHide:true});await app.waitForEvent('close',{timeout:15000}).catch(()=>{});app=null;}
function fixture(name){const dir=path.join(run,name);fs.mkdirSync(dir);db=path.join(dir,'audit.sqlite');return native('seed','seed');}
function state(snapshot){const c=snapshot.collections;const inv=c.purchaseInvoices;return {invoices:inv.length,lines:inv.reduce((n,i)=>n+i.lines.length,0),stock:c.products[0].quantity,avgCost:c.products[0].avgCost,purchasePrice:c.products[0].purchasePrice,branch:c.branchStocks.find(s=>s.branchId==='fin-other'&&s.productId==='fin-product')?.quantity,ledger:c.stockMovements.filter(s=>s.referenceType==='purchase').length,cash:10000+O.number(O.sum(c.cashEntries.map(s=>s.amount))),supplier:O.number(O.sum(inv.flatMap(i=>[i.remaining,-(i.overpayment||0)])))};}
const same=(a,b)=>JSON.stringify(Object.fromEntries(Object.entries(a.collections).filter(([key])=>key!=='auditLogs')))===JSON.stringify(Object.fromEntries(Object.entries(b.collections).filter(([key])=>key!=='auditLogs')));
function command(patch={},other={}){return {invoice:{invoiceNumber:'FIN02-P',date:'2026-10-03',supplierId:'fin-supplier',supplierName:'FIN supplier',branchId:'fin-other',lines:[{id:'l1',productId:'fin-product',quantity:3,price:60,subtotal:180},{id:'l2',productId:'fin-product',quantity:2,price:80,subtotal:160}],total:340,amountPaid:100,...patch},...other};}
try {
 fixture('valid-money');await launch();await page.waitForTimeout(3500);
 const cases=[
 ['undefined-tender',{amountPaid:undefined},false],
 ['negative-tender',{amountPaid:-1},false],
 ['zero-tender',{amountPaid:0},true],
 ['small-decimal-tender',{amountPaid:0.000001},true],
 ['large-finite-tender',{amountPaid:1e100},true],
 ['almost-paid-remains-partial',{amountPaid:339.999999},true],
 ['zero-price',{lines:command().invoice.lines.map(line=>({...line,price:0,subtotal:0})),total:0,amountPaid:0},true],
 ['small-decimal-price',{lines:command().invoice.lines.map(line=>({...line,price:0.000001,subtotal:line.quantity*0.000001})),total:5*0.000001,amountPaid:0},true],
 ['large-finite-price',{lines:command().invoice.lines.map(line=>({...line,price:1e100,subtotal:line.quantity*1e100})),total:5e100,amountPaid:0},true],
 ['overflowing-line-value',{lines:command().invoice.lines.map(line=>({...line,price:Number.MAX_VALUE,subtotal:line.quantity*Number.MAX_VALUE})),total:Infinity,amountPaid:0},false],
 ];
 for(const [id,patch,accepted] of cases){const before=native('inspect',id+'-before');const response=await page.evaluate(c=>window.desktopAPI.purchases.create(c),command(patch));const after=native('inspect',id+'-after');const inv=response.invoice;const statusOk=id!=='almost-paid-remains-partial'||inv?.status==='partial';const unchanged=same(before,after);results.push({id,input:patch,response,expectedAccepted:accepted,canonicalUnchanged:unchanged,pass:response.ok===accepted&&statusOk&&(accepted||unchanged),actual:state(after)});save();}
}catch(error){results.push({id:'harness-error',error:String(error),pass:false});save();process.exitCode=1;}finally{await stop();save();}
if(results.some(row=>!row.pass))process.exitCode=1;
