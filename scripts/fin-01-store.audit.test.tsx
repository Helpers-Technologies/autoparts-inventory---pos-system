// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import type { ReactNode } from 'react';
import { AppProvider, useApp } from '../src/store/AppContext';
import { lsClearAll, lsGet } from '../src/lib/storage';
import { cashBalanceByMethod } from '../src/lib/cashBalance';
import { formatCurrency } from '../src/lib/format';
const O=createRequire(import.meta.url)('./fin-01-oracle.cjs');
const dir='reports/financial-accounting-audit-2026-10';
const evidence:any[]=[];
function compare(id:string,expected:any,actual:any,extra:any={}) {
  const discrepancies=Object.keys(expected).filter(k=>typeof expected[k]==='number'
    ? !Number.isFinite(actual[k]) || Math.abs(expected[k]-actual[k])>1e-8*Math.max(1,Math.abs(expected[k]))
    : expected[k]!==actual[k]).map(field=>({field,expected:expected[field],actual:actual[field]}));
  evidence.push({id,layer:'real AppProvider / isolated localStorage persistence (not desktop SQLite or full UI)',expected,actual,discrepancies,...extra});
}
const wrapper=({children}:{children:ReactNode})=><AppProvider>{children}</AppProvider>;
function fresh() {
  cleanup();localStorage.clear();lsClearAll();
  const h=renderHook(()=>useApp(),{wrapper});
  let product:any,customer:any,supplier:any;
  act(()=>{
    product=h.result.current.addProduct({code:'FIN',name:'FIN audit product',category:'FIN',unit:'unit',purchasePrice:50,wholesalePrice:100,retailPrice:100,quantity:1000,looseQuantity:0,minStock:0,hasExpiry:false,archived:false});
    customer=h.result.current.addCustomer({name:'FIN customer'});
    supplier=h.result.current.addSupplier({name:'FIN supplier'});
  });
  return {h,product,customer,supplier,opening:h.result.current.currentCashBalance()};
}
const line=(product:any,q:number,p:number,id='line')=>({id,productId:product.id,productName:product.name,unit:'unit',quantity:q,price:p,subtotal:q*p});
async function sale(f:any,q:number,p:number,received:number,discount=0) {
  let inv:any;
  await act(async()=>{inv=await f.h.result.current.addSalesInvoice({invoiceNumber:'FIN-S',date:'2026-10-03',customerId:f.customer.id,customerName:f.customer.name,lines:[line(f.product,q,p)],total:q*p-discount,discount,amountReceived:Math.min(received,q*p-discount),overpayment:Math.max(0,received-(q*p-discount)),paymentType:'account',priceType:'retail'});});
  return inv;
}
function state(f:any,id:string,kind='sales') {
  const a=f.h.result.current,inv=(kind==='sales'?a.salesInvoices:a.purchaseInvoices).find((i:any)=>i.id===id)!;
  return {stock:a.products.find((p:any)=>p.id===f.product.id)!.quantity,cash:a.currentCashBalance()-f.opening,balance:kind==='sales'?a.customerBalance(f.customer.id):a.supplierBalance(f.supplier.id),paid:kind==='sales'?inv.amountReceived:inv.amountPaid,remaining:inv.remaining,credit:inv.overpayment??0};
}
it('FIN-01 independently records deterministic, invalid and 300 seeded transaction chains',async()=>{
  fs.mkdirSync(dir,{recursive:true});
  try {
    for(const value of [0,0.001,0.01,0.1,0.3,0.333,1.001,999.999,999999.99,90071992547409.9]) {
      const f=fresh(),q=3,p=value,net=O.invoice([{price:p,quantity:q}]),tender=O.number(net)/2;
      const inv=await sale(f,q,p,tender);const split=O.split(net,O.rational(tender));
      compare('precision-sale-'+value,{stock:997,cash:tender,balance:split.remaining,paid:split.paid,remaining:split.remaining,credit:0},state(f,inv.id),{inputs:{price:p,quantity:q,tender},oracleExactTotal:O.exact(net),formatted:formatCurrency(inv.total),persisted:lsGet('salesInvoices',[])});
    }
    for(const tender of [0,40,100,150]) {
      const f=fresh(),inv=await sale(f,1,100,tender);const sp=O.split(O.rational(100),O.rational(tender));
      compare('sales-payment-'+tender,{stock:999,cash:tender,balance:100-tender,paid:sp.paid,remaining:sp.remaining,credit:sp.credit},state(f,inv.id));
      act(()=>f.h.result.current.recordSalesReceipt(inv.id,25,'cash'));
      const sp2=O.split(O.rational(100),O.rational(tender+25));
      compare('sales-followup-'+tender,{stock:999,cash:tender+25,balance:75-tender,paid:sp2.paid,remaining:sp2.remaining,credit:sp2.credit},state(f,inv.id));
    }
    for(const refundCash of [false,true]) {
      const f=fresh(),inv=await sale(f,10,100,400);
      act(()=>f.h.result.current.addSalesReturn({date:'2026-10-03',originalInvoiceId:inv.id,originalInvoiceNumber:inv.invoiceNumber,customerId:f.customer.id,customerName:f.customer.name,lines:[{...line(f.product,2,100,'r'),sourceLineId:'line'}],total:200,refundCash}));
      compare('sales-partial-return-'+refundCash,{stock:992,cash:refundCash?200:400,balance:refundCash?600:400,paid:refundCash?200:400,remaining:refundCash?600:400,credit:0},state(f,inv.id));
      const due=refundCash?600:400;
      act(()=>f.h.result.current.recordSalesReceipt(inv.id,due,'cash'));
      compare('sales-payment-after-return-'+refundCash,{stock:992,cash:800,balance:0,paid:800,remaining:0,credit:0},state(f,inv.id));
    }
    for(const tender of [0,400,1000,1200]) {
      const f=fresh();let inv:any;
      act(()=>{inv=f.h.result.current.addPurchaseInvoice({invoiceNumber:'FIN-P',date:'2026-10-03',supplierId:f.supplier.id,supplierName:f.supplier.name,lines:[line(f.product,10,100)],total:1000,amountPaid:tender});});
      const s=O.split(O.rational(1000),O.rational(tender));
      compare('purchase-'+tender,{stock:1010,cash:-tender,balance:1000-tender,paid:s.paid,remaining:s.remaining,credit:s.credit},state(f,inv.id,'purchase'));
      act(()=>f.h.result.current.addPurchaseReturn({date:'2026-10-03',originalInvoiceId:inv.id,originalInvoiceNumber:inv.invoiceNumber,supplierId:f.supplier.id,supplierName:f.supplier.name,lines:[{...line(f.product,2,100,'r'),sourceLineId:'line'}],total:200}));
      const r=O.split(O.rational(800),O.rational(tender));
      compare('purchase-return-'+tender,{stock:1008,cash:-tender,balance:800-tender,paid:r.paid,remaining:r.remaining,credit:r.credit},state(f,inv.id,'purchase'),{rule:'No actual supplier cash refund was requested; credits are retained obligations.'});
    }
    // Real action boundary, including inputs the UI should reject. Preserve observed acceptance.
    for(const [id,quantity,price,total,paid] of [
      ['negative-price',1,-100,-100,0],['negative-quantity',-2,100,-200,0],['zero-quantity',0,100,0,0],['nan-price',1,NaN,NaN,0],['infinite-payment',1,100,100,Infinity],['mismatched-total',1,100,999,0],
    ] as const) {
      const f=fresh();let accepted=false,error:string|undefined;
      try {act(()=>{f.h.result.current.addPurchaseInvoice({invoiceNumber:'INVALID',date:'2026-10-03',supplierId:f.supplier.id,supplierName:f.supplier.name,lines:[line(f.product,quantity,price)],total,amountPaid:paid});});accepted=true;}catch(e){error=String(e);}
      compare('invalid-purchase-'+id,{accepted:false},{accepted},{inputs:{quantity:String(quantity),price:String(price),total:String(total),paid:String(paid)},error,canonicalLocalStorage:lsGet('purchaseInvoices',[])});
    }
    {
      const f=fresh(),inv=await sale(f,1,100,100);
      act(()=>f.h.result.current.addSalesReturn({date:'2026-10-03',originalInvoiceId:'unknown',originalInvoiceNumber:'unknown',customerId:f.customer.id,customerName:f.customer.name,lines:[line(f.product,2,100)],total:200,refundCash:true}));
      compare('unknown-invoice-return',{stock:999,cash:100,balance:0,paid:100,remaining:0,credit:0},state(f,inv.id));
    }
    {
      const f=fresh(),inv=await sale(f,1,100,100);
      for(let n=0;n<2;n++)act(()=>f.h.result.current.addSalesReturn({date:'2026-10-03',originalInvoiceId:inv.id,originalInvoiceNumber:inv.invoiceNumber,customerId:f.customer.id,customerName:f.customer.name,lines:[{...line(f.product,1,100,'r'),sourceLineId:'line'}],total:100,refundCash:false}));
      compare('duplicate-over-return',{stock:1000,cash:100,balance:-100,paid:0,remaining:0,credit:100},state(f,inv.id));
    }
    {
      const f=fresh(),inv=await sale(f,1,100,0);
      act(()=>f.h.result.current.recordSalesReceipt(inv.id,NaN,'cash'));
      compare('nan-customer-payment',{stock:999,cash:0,balance:100,paid:0,remaining:100,credit:0},state(f,inv.id),{canonicalLocalStorage:lsGet('salesInvoices',[])});
    }
    {
      const f=fresh();await sale(f,1,100,110);const target=await sale(f,1,100,0);
      act(()=>f.h.result.current.applyCustomerCredit(f.customer.id,target.id,100));
      compare('credit-application-exceeds-source',{stock:998,cash:110,balance:90,paid:10,remaining:90,credit:0},state(f,target.id),{rule:'Only 10 credit exists; applying 100 must not create 90 additional settlement.'});
    }
    for(const settlement of ['applyCustomerCredit','settleAllDues']) {
      const f=fresh();await sale(f,1,100,180);const target=await sale(f,1,100,0);
      act(()=>f.h.result.current.addSalesReturn({date:'2026-10-03',originalInvoiceId:target.id,originalInvoiceNumber:target.invoiceNumber,customerId:f.customer.id,customerName:f.customer.name,lines:[{...line(f.product,0.2,100,'r'),sourceLineId:'line'}],total:20,refundCash:false}));
      act(()=>settlement==='applyCustomerCredit'?f.h.result.current.applyCustomerCredit(f.customer.id,target.id,80):f.h.result.current.settleAllDues(f.customer.id));
      compare('credit-after-return-'+settlement,{stock:998.2,cash:180,balance:0,paid:80,remaining:0,credit:0},state(f,target.id));
    }
    for(let seed=1;seed<=300;seed++) {
      const f=fresh(),random=O.rng(seed),q=2+Math.floor(random()*8),p=1+Math.floor(random()*9999)/100;
      const discount=Math.floor(random()*100)/100,net=O.invoice([{price:p,quantity:q}],discount),N=O.number(net);
      const purchasePrice=30+Math.floor(random()*7000)/100,purchasePaid=purchasePrice*2.5;let purchase:any;
      act(()=>{purchase=f.h.result.current.addPurchaseInvoice({invoiceNumber:'SEED-P',date:'2026-10-03',supplierId:f.supplier.id,supplierName:f.supplier.name,lines:[line(f.product,5,purchasePrice)],total:purchasePrice*5,amountPaid:purchasePaid});});
      const purchaseNet=O.invoice([{quantity:5,price:purchasePrice}]),purchaseSplit=O.split(purchaseNet,O.rational(purchasePaid));
      compare(`seed-${seed}-purchase`,{stock:1005,cash:-purchasePaid,balance:O.number(purchaseNet)-purchasePaid,paid:purchaseSplit.paid,remaining:purchaseSplit.remaining,credit:0},state(f,purchase.id,'purchase'),{seed,op:'purchase',oracleExact:O.exact(purchaseNet)});
      let cash=O.rational(0),returned=O.rational(0);const inv=await sale(f,q,p,0,discount),steps:any[]=[];
      const reconcile=(op:string,stock:number)=>{const effective=O.sub(net,returned),C=O.number(cash),E=O.number(effective),sp=O.split(effective,cash);compare(`seed-${seed}-${op}`,{stock:stock+5,cash:O.number(O.sub(cash,O.rational(purchasePaid))),balance:E-C,paid:sp.paid,remaining:sp.remaining,credit:sp.credit},state(f,inv.id),{seed,op,oracleExact:{net:O.exact(net),cash:O.exact(cash),returned:O.exact(returned)}});steps.push(op);};
      reconcile('credit-sale',1000-q);
      const payment=Math.floor(N*random()*100)/100;cash=O.add(cash,O.rational(payment));
      act(()=>f.h.result.current.recordSalesReceipt(inv.id,payment,'cash'));reconcile('partial-payment',1000-q);
      const rq=1,rv=O.mul(O.rational(rq),O.rational(p));returned=O.add(returned,rv);
      act(()=>f.h.result.current.addSalesReturn({date:'2026-10-03',originalInvoiceId:inv.id,originalInvoiceNumber:inv.invoiceNumber,customerId:f.customer.id,customerName:f.customer.name,lines:[{...line(f.product,rq,p,'return'),sourceLineId:'line'}],total:O.number(rv),refundCash:false}));reconcile('credit-return',1001-q);
      const outstanding=Math.max(0,O.number(O.sub(O.sub(net,returned),cash)));cash=O.add(cash,O.rational(outstanding));
      act(()=>f.h.result.current.recordSalesReceipt(inv.id,outstanding,'cash'));reconcile('settlement',1001-q);
      const extra=Math.floor(random()*10000)/100;cash=O.add(cash,O.rational(extra));
      act(()=>f.h.result.current.recordSalesReceipt(inv.id,extra,'cash'));reconcile('overpayment',1001-q);
      act(()=>f.h.result.current.addPurchaseReturn({date:'2026-10-03',originalInvoiceId:purchase.id,originalInvoiceNumber:purchase.invoiceNumber,supplierId:f.supplier.id,supplierName:f.supplier.name,lines:[{...line(f.product,1,purchasePrice,'pr'),sourceLineId:'line'}],total:purchasePrice}));
      const purchaseAfter=O.invoice([{quantity:4,price:purchasePrice}]),sp=O.split(purchaseAfter,O.rational(purchasePaid));
      compare(`seed-${seed}-purchase-return`,{stock:1005-q,cash:O.number(O.sub(cash,O.rational(purchasePaid))),balance:O.number(purchaseAfter)-purchasePaid,paid:sp.paid,remaining:sp.remaining,credit:0},state(f,purchase.id,'purchase'),{seed,op:'purchase-return'});
      await act(async()=>{await f.h.result.current.hydrateStockMovements();});
      const ledger=f.h.result.current.stockMovements.filter(x=>x.productId===f.product.id).reduce((s,x)=>s+x.quantity,0);
      compare(`seed-${seed}-stock-ledger`,{quantity:5-q},{quantity:ledger},{seed});
      evidence.push({id:`seed-${seed}`,seed,inputs:{quantity:q,price:p,discount,payment,extra,purchasePrice,purchasePaid},steps:['purchase',...steps,'purchase-return','stock-ledger'],layer:'AppProvider',type:'randomized-sequence'});
    }
    for(const amount of [0.001,0.005,0.333,1.001,-0.005]) {
      const rows=cashBalanceByMethod([{id:'cash',date:'2026-10-03',type:'adjustment',amount,description:'precision'}],0);
      evidence.push({id:'cash-display-'+amount,layer:'helper/display',canonicalAmount:amount,methodView:rows,formatted:formatCurrency(amount),negativeZero:Object.is(rows[0]?.net,-0)});
    }
  } finally {cleanup();fs.writeFileSync(`${dir}/store-evidence.json`,JSON.stringify(evidence,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v,2)+'\n');}
  expect(evidence.filter(x=>x.type==='randomized-sequence')).toHaveLength(300);
  expect(evidence.filter(x=>x.discrepancies?.length).map(x=>({id:x.id,discrepancies:x.discrepancies}))).toEqual([]);
});
