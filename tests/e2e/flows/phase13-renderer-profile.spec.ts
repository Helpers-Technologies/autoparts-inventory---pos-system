import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const sourceDb = process.env.PARTFLOW_STRESS_DB;
const scale = process.env.PARTFLOW_PHASE13_SCALE || "unknown";
const outputPath = process.env.PARTFLOW_PHASE13_OUT;
const customerId = process.env.PARTFLOW_PHASE13_CUSTOMER_ID || "";
const customerQuery = process.env.PARTFLOW_PHASE13_CUSTOMER_QUERY || "";
const invoiceQuery = process.env.PARTFLOW_PHASE13_INVOICE_QUERY || "";

type CpuNode = { id:number; callFrame:{ functionName:string; url:string; lineNumber:number } };
const pct = (values:number[], ratio:number) => [...values].sort((a,b)=>a-b)[Math.min(values.length-1, Math.ceil(values.length * ratio)-1)];
const compact = (values:number[]) => ({
  p50:Number(pct(values,.5).toFixed(3)), p95:Number(pct(values,.95).toFixed(3)),
  p99:Number(pct(values,.99).toFixed(3)), values:values.map((value)=>Number(value.toFixed(3))),
});

test.describe("Phase 13 renderer profile", () => {
  test.skip(!sourceDb || !outputPath || !customerId || !customerQuery || !invoiceQuery, "Phase 13 profiling environment is required");

  // eslint-disable-next-line no-empty-pattern
  test("profiles representative interactions without touching the fixture", async ({}) => {
    test.setTimeout(30 * 60_000);
    if (!sourceDb || !outputPath) return;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `partflow-phase13-${scale}-`));
    const dbPath = path.join(scratch, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(path.resolve(sourceDb), dbPath);
    const report: Record<string, unknown> = { scale, sourceDb:path.resolve(sourceDb), isolatedDb:dbPath, sourceBytes:fs.statSync(sourceDb).size };
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      const env:NodeJS.ProcessEnv = { ...process.env, NODE_ENV:"test", HW_E2E:"1", HW_E2E_DB_PATH:dbPath };
      delete env.ELECTRON_RENDERER_URL;
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({ args:[path.resolve("electron/main.cjs")], env:env as Record<string,string>, timeout:180_000 });
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByPlaceholder("Login username")).toBeVisible({ timeout:180_000 });
      await page.evaluate(() => {
        const target = window as unknown as { __phase13Stage:string; __phase13LongTasks:Array<{ start:number; duration:number; stage:string }> };
        target.__phase13Stage = "login";
        target.__phase13LongTasks = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) target.__phase13LongTasks.push({ start:entry.startTime, duration:entry.duration, stage:target.__phase13Stage });
        }).observe({ entryTypes:["longtask"] });
      });
      await page.getByPlaceholder("Login username").fill("admin");
      await page.locator('input[type="password"]').first().fill("stress123");
      const loginStarted = performance.now();
      await page.getByRole("button", { name:"تسجيل الدخول" }).click();
      await expect(page.getByRole("button", { name:"تسجيل الخروج" })).toBeVisible({ timeout:300_000 });
      report.loginUsableMs = Number((performance.now()-loginStarted).toFixed(3));

      const whatsNew = page.getByRole("button", { name:/تمام.*فهمت/ }).first();
      if (await whatsNew.isVisible({ timeout:500 }).catch(()=>false)) await whatsNew.click().catch(()=>undefined);

      const dashboardStarted = performance.now();
      await page.evaluate(()=>{(window as unknown as {__phase13Stage:string}).__phase13Stage="dashboard";});
      const dashboardPayload = await page.evaluate(async () => {
        const started = performance.now();
        const value = await window.desktopAPI!.storage.getDashboardSummary!();
        return { milliseconds:performance.now()-started, bytes:new TextEncoder().encode(JSON.stringify(value)).length };
      });
      report.dashboard = { userVisibleMs:Number((performance.now()-dashboardStarted).toFixed(3)), ...dashboardPayload };

      const ipcSearch = async (query:string, runs:number) => {
        const rows:Array<{ roundTripMs:number; queryMs:number; payloadBytes:number }> = [];
        for (let index=0; index<runs; index+=1) rows.push(await page.evaluate(async (q) => {
          const started=performance.now();
          const response=await window.desktopAPI!.query!.globalSearch({ q });
          return { roundTripMs:performance.now()-started, queryMs:response.queryMs || 0, payloadBytes:response.payloadBytes || 0 };
        }, query));
        return { roundTrip:compact(rows.map((row)=>row.roundTripMs)), query:compact(rows.map((row)=>row.queryMs)), payloadBytes:rows.at(-1)?.payloadBytes || 0 };
      };
      await page.evaluate(()=>{(window as unknown as {__phase13Stage:string}).__phase13Stage="global-search-ipc";});
      report.globalSearchIpc = { invoice:await ipcSearch(invoiceQuery,12), customer:await ipcSearch(customerQuery,12) };

      await page.evaluate(()=>{(window as unknown as {__phase13Stage:string}).__phase13Stage="global-search-ui";});
      const searchUi:number[] = [];
      for (let index=0; index<20; index+=1) {
        await page.getByRole("button", { name:/بحث شامل/ }).click();
        const input=page.getByPlaceholder(/رقم القطعة.*OEM/).first();
        await expect(input).toBeVisible();
        const started=performance.now();
        await input.fill(customerQuery);
        await expect(page.locator('[data-idx="0"]')).toBeVisible({ timeout:10_000 });
        searchUi.push(performance.now()-started);
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
      report.globalSearchVisible = compact(searchUi);

      await page.evaluate(()=>{(window as unknown as {__phase13Stage:string}).__phase13Stage="customer-statement";});
      const statementRows:Array<{ roundTripMs:number; queryMs:number; payloadBytes:number }> = [];
      for(let index=0; index<12; index+=1) statementRows.push(await page.evaluate(async ({ id }) => {
        const started=performance.now();
        const response=await window.desktopAPI!.query!.statement("customer",id,{page:0,pageSize:50});
        return { roundTripMs:performance.now()-started, queryMs:response.queryMs || 0, payloadBytes:response.payloadBytes || 0 };
      }, { id:customerId }));
      const statementVisibleStarted=performance.now();
      await page.evaluate((id)=>{window.location.hash=`#/customers/${id}`;},customerId);
      await page.waitForFunction((id)=>window.location.hash===`#/customers/${id}` && (document.querySelector("main")?.textContent?.length || 0)>100,customerId,{timeout:60_000});
      await page.evaluate(()=>new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      report.customerStatement = {
        roundTrip:compact(statementRows.map((row)=>row.roundTripMs)), query:compact(statementRows.map((row)=>row.queryMs)),
        payloadBytes:statementRows.at(-1)?.payloadBytes || 0, firstVisibleMs:Number((performance.now()-statementVisibleStarted).toFixed(3)),
      };

      if(process.env.PARTFLOW_PHASE13_SKIP_POS === "1"){
        const memoryCdp=await page.context().newCDPSession(page);
        await memoryCdp.send("HeapProfiler.enable");
        await memoryCdp.send("HeapProfiler.collectGarbage");
        const heapMiB=await page.evaluate(()=>Number((((performance as unknown as {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize||0)/1048576).toFixed(1)));
        const appMetrics=await app.evaluate(({app:electronApp})=>electronApp.getAppMetrics().map((metric)=>({type:metric.type,workingSetMiB:Number(((metric.memory?.workingSetSize||0)/1024).toFixed(1)),peakWorkingSetMiB:Number(((metric.memory?.peakWorkingSetSize||0)/1024).toFixed(1))})));
        report.pos={initialUsableMs:null,outcome:"separate-run-renderer-unresponsive",observedLowerBoundMs:Number(process.env.PARTFLOW_PHASE13_POS_OBSERVED_TIMEOUT_MS || 0)};
        report.memory={beforePos:{heapMiB},appMetrics};
        report.longTasks=await page.evaluate(()=>(window as unknown as {__phase13LongTasks:Array<{start:number;duration:number}>}).__phase13LongTasks.filter((row)=>row.duration>=50));
        report.measuredAt=new Date().toISOString();
        return;
      }

      const cdp=await page.context().newCDPSession(page);
      const rendererHeapMiB=()=>page.evaluate(()=>Number((((performance as unknown as {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize||0)/1048576).toFixed(1)));
      const heapBeforePos=await rendererHeapMiB();
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval",{interval:500});
      await cdp.send("Profiler.start");
      const posStarted=performance.now();
      await page.evaluate(()=>{(window as unknown as {__phase13Stage:string}).__phase13Stage="pos";});
      await page.evaluate(()=>{window.location.hash="#/pos";});
      const posSearch=page.getByPlaceholder(/ابحث عن منتج بالاسم/).first();
      const posTimeoutMs=Math.max(30_000,Number(process.env.PARTFLOW_PHASE13_POS_TIMEOUT_MS || 120_000));
      const posReady=await posSearch.waitFor({state:"visible",timeout:posTimeoutMs}).then(()=>true).catch(()=>false);
      if(!posReady){
        await cdp.send("Profiler.stop").catch(()=>undefined);
        const timedOutMs=performance.now()-posStarted;
        const heapMiB=await page.evaluate(()=>Number((((performance as unknown as {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize||0)/1048576).toFixed(1))).catch(()=>0);
        const appMetrics=await app.evaluate(({app:electronApp})=>electronApp.getAppMetrics().map((metric)=>({type:metric.type,workingSetMiB:Number(((metric.memory?.workingSetSize||0)/1024).toFixed(1)),peakWorkingSetMiB:Number(((metric.memory?.peakWorkingSetSize||0)/1024).toFixed(1))})));
        report.pos={initialUsableMs:null,outcome:"timeout",timeoutMs:Number(timedOutMs.toFixed(3))};
        report.memory={atPosTimeout:{heapMiB},appMetrics};
        report.longTasks=await page.evaluate(()=>(window as unknown as {__phase13LongTasks:Array<{start:number;duration:number}>}).__phase13LongTasks.filter((row)=>row.duration>=50));
        report.measuredAt=new Date().toISOString();
        return;
      }
      await expect(page.getByTestId("pos-product-tile").first()).toBeVisible({timeout:60_000});
      const posUsableMs=performance.now()-posStarted;
      const heapAtPosUsable=await rendererHeapMiB();
      const cancelShift=page.getByRole("button",{name:"إلغاء"}).first();
      if(await cancelShift.isVisible({timeout:500}).catch(()=>false)) await cancelShift.click();
      const customerSearchValues:number[]=[];
      await page.getByTestId("pos-customer-select").locator("button").first().click();
      const customerSearch=page.getByPlaceholder(/ابحث باسم العميل/).first();
      await expect(customerSearch).toBeVisible();
      for(let index=0;index<20;index+=1){
        const started=performance.now();
        await customerSearch.fill(customerQuery);
        await expect(page.locator('#searchable-select-portal button').first()).toBeVisible();
        await page.evaluate(()=>new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
        customerSearchValues.push(performance.now()-started);
        await customerSearch.fill("");
      }
      await page.keyboard.press("Escape");
      const title=(await page.getByTestId("pos-product-tile").first().locator("h3").getAttribute("title")) || "";
      const productTerm=title.split(/\s+/)[0] || title;
      const productSearchValues:number[]=[];
      for(let index=0;index<20;index+=1){
        const started=performance.now();
        await posSearch.fill(productTerm);
        await expect(page.getByTestId("pos-product-tile").first()).toBeVisible();
        await page.evaluate(()=>new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
        productSearchValues.push(performance.now()-started);
        await posSearch.fill("");
      }
      const tile=page.locator('[data-testid="pos-product-tile"][data-pos-can-increment="true"]').first();
      await expect(tile).toBeVisible();
      const addStarted=performance.now(); await tile.click();
      await expect(page.getByTestId("pos-line-quantity").first()).toBeVisible();
      const addItemMs=performance.now()-addStarted;
      const increaseStarted=performance.now(); await page.getByTestId("pos-line-increase").first().click();
      await expect(page.getByTestId("pos-line-quantity").first()).toHaveValue("2");
      const quantityMs=performance.now()-increaseStarted;
      const removeStarted=performance.now(); await page.getByTestId("pos-line-remove").first().click();
      await expect(page.getByTestId("pos-line-quantity")).toHaveCount(0);
      const removeMs=performance.now()-removeStarted;
      const heapAfterInteractions=await rendererHeapMiB();
      const { profile }=await cdp.send("Profiler.stop");
      const byId=new Map((profile.nodes as unknown as CpuNode[]).map((node)=>[node.id,node]));
      const self=new Map<number,number>();
      for(let index=0;index<(profile.samples?.length || 0);index+=1) self.set(profile.samples![index],(self.get(profile.samples![index])||0)+(profile.timeDeltas?.[index]||0));
      const cpu=[...self].map(([id,microseconds])=>{const frame=byId.get(id)?.callFrame;return{milliseconds:Number((microseconds/1000).toFixed(3)),function:frame?.functionName||"(anonymous)",source:frame?`${frame.url.split("/").at(-1)}:${frame.lineNumber+1}`:"?"};}).filter((row)=>row.milliseconds>=20).sort((a,b)=>b.milliseconds-a.milliseconds).slice(0,20);
      report.pos={initialUsableMs:Number(posUsableMs.toFixed(3)),productSearch:compact(productSearchValues),customerSearch:compact(customerSearchValues),addItemMs:Number(addItemMs.toFixed(3)),quantityMs:Number(quantityMs.toFixed(3)),removeMs:Number(removeMs.toFixed(3)),cpu};

      await cdp.send("HeapProfiler.enable");
      await cdp.send("HeapProfiler.collectGarbage");
      const memoryBeforeInventory=await page.evaluate(()=>({heapMiB:Number((((performance as unknown as {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize||0)/1048576).toFixed(1))}));
      await page.evaluate(()=>{(window as unknown as {__phase13Stage:string}).__phase13Stage="inventory";});
      const inventoryStarted=performance.now();
      await page.evaluate(()=>{window.location.hash="#/inventory";});
      await page.waitForFunction(()=>window.location.hash==="#/inventory" && (document.querySelector("main")?.textContent?.length||0)>100,{timeout:60_000});
      const memoryAfterInventory=await page.evaluate(()=>({heapMiB:Number((((performance as unknown as {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize||0)/1048576).toFixed(1))}));
      const appMetrics=await app.evaluate(({app:electronApp})=>electronApp.getAppMetrics().map((metric)=>({type:metric.type,workingSetMiB:Number(((metric.memory?.workingSetSize||0)/1024).toFixed(1)),peakWorkingSetMiB:Number(((metric.memory?.peakWorkingSetSize||0)/1024).toFixed(1))})));
      report.memory={beforePos:{heapMiB:heapBeforePos},atPosUsable:{heapMiB:heapAtPosUsable},afterInteractions:{heapMiB:heapAfterInteractions},beforeInventory:memoryBeforeInventory,afterLeavingPos:memoryAfterInventory,afterInventory:memoryAfterInventory,appMetrics,inventoryNavigationMs:Number((performance.now()-inventoryStarted).toFixed(3))};
      report.longTasks=await page.evaluate(()=>(window as unknown as {__phase13LongTasks:Array<{start:number;duration:number}>}).__phase13LongTasks.filter((row)=>row.duration>=50));
      report.measuredAt=new Date().toISOString();
    } finally {
      if(app) await app.close().catch(()=>undefined);
      fs.mkdirSync(path.dirname(outputPath),{recursive:true});
      fs.writeFileSync(outputPath,`${JSON.stringify(report,null,2)}\n`);
      fs.rmSync(scratch,{recursive:true,force:true});
    }
  });
});
