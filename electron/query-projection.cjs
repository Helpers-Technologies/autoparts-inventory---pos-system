"use strict";

// Phase 12 read projection.
//
// Canonical business data remains in the encrypted, chunked kv_store.  These
// tables contain only queryable summaries and line facts.  A record detail is
// read from its canonical chunk, so the projection never becomes a second
// source of truth.  Rebuilds are transactional and the completion marker is
// written last; an interrupted rebuild therefore rolls back completely.

const STORE_PREFIX = "autoparts_inventory_v1::";
const VERSION = 7;
const TOMBSTONE = '"__partflow_chunked__"';
const ACTIVE_UPGRADE_STATES = new Set(["PREPARING", "BUILDING", "VALIDATING", "FINALIZING"]);
const SEARCH_ENTITIES = new Set(["salesInvoices","purchaseInvoices","quotations"]);
const CATALOG_ENTITIES = new Set(["products", "customers", "suppliers"]);
const META_ONLY_ENTITIES = new Set(["products", "cashEntries", "mobileStockOpReceipts"]);
const productCutoffDate=new Date();productCutoffDate.setDate(productCutoffDate.getDate()-120);
const PRODUCT_DAILY_CUTOFF=productCutoffDate.toISOString().slice(0,10);

const ENTITY_CONFIG = {
  salesInvoices: { number: "invoiceNumber", partyId: "customerId", partyName: "customerName", lines: true },
  purchaseInvoices: { number: "invoiceNumber", partyId: "supplierId", partyName: "supplierName", lines: true },
  customers: { number: "code", partyName: "name" },
  suppliers: { number: "code", partyName: "name" },
  products: { number: "code", partyName: "name" },
  salesReturns: { number: "returnNumber", partyId: "customerId", partyName: "customerName", lines: true },
  purchaseReturns: { number: "returnNumber", partyId: "supplierId", partyName: "supplierName", lines: true },
  quotations: { number: "quotationNumber", partyId: "customerId", partyName: "customerName", lines: true },
  cashEntries: {},
  stockMovements: { partyId: "productId", partyName: "productName" },
  mobileStockOpReceipts: { number: "clientOpId", partyId: "productId", partyName: "productName" },
};

const PROJECTION_ENTITIES = Object.freeze(Object.keys(ENTITY_CONFIG));

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function createControlSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pf_projection_upgrade_state (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      run_id TEXT NOT NULL DEFAULT '',
      processed_records INTEGER NOT NULL DEFAULT 0,
      total_records INTEGER NOT NULL DEFAULT 0,
      stage_detail TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pf_projection_completion (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      version INTEGER NOT NULL,
      source_signature TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
  `);
}

function projectionSourceSnapshot(db) {
  return PROJECTION_ENTITIES.map((entity) => {
    const source = canonicalState(db, entity);
    return { entity, updatedAt: source.updatedAt, count: source.count, chunks: source.chunks || (Array.isArray(source.plain) ? 1 : 0) };
  });
}

function sourceSignature(snapshot) {
  return snapshot.map((row) => `${row.entity}:${row.updatedAt}:${row.count}`).join("|");
}

function entityMarkerIsCurrent(db, source) {
  if (!tableExists(db, "pf_query_projection_meta")) return false;
  const marker = db.prepare("SELECT version,canonical_updated_at,canonical_count FROM pf_query_projection_meta WHERE entity=?").get(source.entity);
  return Boolean(marker && marker.version === VERSION && marker.canonical_updated_at === source.updatedAt && marker.canonical_count === source.count);
}

function inspectUpgrade(db) {
  const snapshot = projectionSourceSnapshot(db);
  const totalRecords = snapshot.reduce((sum, row) => sum + row.count, 0);
  const currentEntities = snapshot.filter((source) => entityMarkerIsCurrent(db, source)).map((source) => source.entity);
  const allEntitiesCurrent = currentEntities.length === snapshot.length;
  const signature = sourceSignature(snapshot);
  const completion = tableExists(db, "pf_projection_completion")
    ? db.prepare("SELECT version,source_signature,completed_at FROM pf_projection_completion WHERE singleton=1").get()
    : null;
  const storedState = tableExists(db, "pf_projection_upgrade_state")
    ? db.prepare("SELECT * FROM pf_projection_upgrade_state WHERE singleton=1").get()
    : null;
  const completionValid = Boolean(completion && completion.version === VERSION && completion.source_signature === signature && allEntitiesCurrent);
  let state = completionValid || (!completion && allEntitiesCurrent) ? "NOT_REQUIRED" : "REQUIRED";
  if (!completionValid && storedState?.state === "FAILED") state = "FAILED";
  else if (!completionValid && ACTIVE_UPGRADE_STATES.has(storedState?.state)) state = "INTERRUPTED";
  return {
    state,
    version: VERSION,
    totalRecords,
    currentEntities,
    pendingEntities: snapshot.filter((row) => !currentEntities.includes(row.entity)).map((row) => row.entity),
    sourceSignature: signature,
    completionValid,
    completedAt: completion?.completed_at || "",
    errorCode: storedState?.error_code || "",
    stageDetail: storedState?.stage_detail || "",
    snapshot,
  };
}

function writeUpgradeState(db, input) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO pf_projection_upgrade_state(singleton,state,version,run_id,processed_records,total_records,stage_detail,error_code,started_at,updated_at)
    VALUES(1,@state,@version,@runId,@processedRecords,@totalRecords,@stageDetail,@errorCode,@startedAt,@updatedAt)
    ON CONFLICT(singleton) DO UPDATE SET state=excluded.state,version=excluded.version,run_id=excluded.run_id,
      processed_records=excluded.processed_records,total_records=excluded.total_records,stage_detail=excluded.stage_detail,
      error_code=excluded.error_code,started_at=excluded.started_at,updated_at=excluded.updated_at`).run({
    state: input.state, version: VERSION, runId: input.runId || "",
    processedRecords: Math.max(0, Number(input.processedRecords) || 0),
    totalRecords: Math.max(0, Number(input.totalRecords) || 0),
    stageDetail: input.stageDetail || "", errorCode: input.errorCode || "",
    startedAt: input.startedAt || now, updatedAt: now,
  });
}

function adoptCurrentProjection(db) {
  const status = inspectUpgrade(db);
  if (status.completionValid) return status;
  if (status.currentEntities.length !== status.snapshot.length) return status;
  const now = new Date().toISOString();
  createControlSchema(db);
  db.transaction(() => {
    db.prepare("INSERT INTO pf_projection_completion(singleton,version,source_signature,completed_at) VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET version=excluded.version,source_signature=excluded.source_signature,completed_at=excluded.completed_at")
      .run(VERSION, status.sourceSignature, now);
    writeUpgradeState(db, { state: "COMPLETE", totalRecords: status.totalRecords, processedRecords: status.totalRecords, stageDetail: "already-current", startedAt: now });
  }).immediate();
  return inspectUpgrade(db);
}

function createSchema(db) {
  createControlSchema(db);
  const legacy = db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name='pf_query_records'").get();
  const hasMeta = db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name='pf_query_projection_meta'").get();
  const legacyVersion = hasMeta ? db.prepare("SELECT version FROM pf_query_projection_meta LIMIT 1").get()?.version : null;
  const legacyColumns = legacy
    ? new Set(db.prepare("PRAGMA table_info(pf_query_records)").all().map((row) => row.name))
    : new Set();
  if (legacy && (legacyVersion && legacyVersion !== VERSION || legacyColumns.has("content_hash"))) {
    db.exec(`
      DROP TABLE IF EXISTS pf_query_search;
      DROP TABLE IF EXISTS pf_query_lines;
      DROP TABLE IF EXISTS pf_query_records;
      DROP TABLE IF EXISTS pf_stock_movements;
      DROP TABLE IF EXISTS pf_dashboard_daily;
      DROP TABLE IF EXISTS pf_due_daily;
      DROP TABLE IF EXISTS pf_dashboard_product_daily;
      DROP TABLE IF EXISTS pf_catalog_search;
      DROP TABLE IF EXISTS pf_party_balances;
      DROP TABLE IF EXISTS pf_dashboard_cache;
      DROP TABLE IF EXISTS pf_query_projection_meta;
      DELETE FROM pf_projection_completion;
    `);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS pf_query_projection_meta (
      entity TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      canonical_updated_at TEXT NOT NULL,
      canonical_count INTEGER NOT NULL,
      sum_total REAL NOT NULL DEFAULT 0,
      sum_paid REAL NOT NULL DEFAULT 0,
      sum_remaining REAL NOT NULL DEFAULT 0,
      sum_overpayment REAL NOT NULL DEFAULT 0,
      sum_receivable REAL NOT NULL DEFAULT 0,
      outstanding_count INTEGER NOT NULL DEFAULT 0,
      outstanding_total REAL NOT NULL DEFAULT 0,
      outstanding_paid REAL NOT NULL DEFAULT 0,
      outstanding_remaining REAL NOT NULL DEFAULT 0,
      completed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pf_query_records (
      entity TEXT NOT NULL,
      id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      date TEXT NOT NULL DEFAULT '',
      number TEXT NOT NULL DEFAULT '',
      party_id TEXT NOT NULL DEFAULT '',
      party_name TEXT NOT NULL DEFAULT '',
      driver_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      payment_type TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '',
      branch_id TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      reference_id TEXT NOT NULL DEFAULT '',
      cancelled INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      collect_on_delivery INTEGER NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      remaining REAL NOT NULL DEFAULT 0,
      overpayment REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      gross_profit REAL NOT NULL DEFAULT 0,
      search_text TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (entity, id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS pf_stock_movements (
      id TEXT PRIMARY KEY,
      chunk_index INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      date TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL DEFAULT '',
      movement_type TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      reference_id TEXT NOT NULL DEFAULT ''
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS pf_dashboard_daily (
      entity TEXT NOT NULL,
      date TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      profit REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(entity,date)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS pf_due_daily (
      due_date TEXT PRIMARY KEY,
      invoice_count INTEGER NOT NULL DEFAULT 0,
      remaining_total REAL NOT NULL DEFAULT 0
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS pf_dashboard_product_daily (
      entity TEXT NOT NULL,
      date TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      revenue REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(entity,date,product_id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS pf_catalog_search (
      entity TEXT NOT NULL,
      id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      ordinal INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(entity,id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS pf_party_balances (
      entity TEXT NOT NULL,
      party_id TEXT NOT NULL,
      party_name TEXT NOT NULL DEFAULT '',
      balance REAL NOT NULL DEFAULT 0,
      open_invoices INTEGER NOT NULL DEFAULT 0,
      last_activity TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(entity,party_id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS pf_dashboard_cache (
      cache_key TEXT PRIMARY KEY,
      projection_token TEXT NOT NULL,
      result_json TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pf_records_entity_date
      ON pf_query_records(entity, date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_pf_records_entity_number
      ON pf_query_records(entity, number COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_pf_records_entity_party_date
      ON pf_query_records(entity, party_id, date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_pf_records_outstanding
      ON pf_query_records(entity, date DESC, id DESC) WHERE cancelled=0 AND remaining>0;
    CREATE INDEX IF NOT EXISTS idx_pf_records_due_outstanding
      ON pf_query_records(entity,due_date,id) WHERE cancelled=0 AND remaining>0;
    CREATE INDEX IF NOT EXISTS idx_pf_records_entity_reference
      ON pf_query_records(entity, reference_id);
    CREATE INDEX IF NOT EXISTS idx_pf_stock_product_date
      ON pf_stock_movements(product_id,date DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_pf_stock_date
      ON pf_stock_movements(date DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_pf_dashboard_product_date
      ON pf_dashboard_product_daily(date,entity,product_id);
    CREATE INDEX IF NOT EXISTS idx_pf_catalog_code
      ON pf_catalog_search(entity,code COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_pf_party_balance
      ON pf_party_balances(entity,balance,party_id);
  `);
  const recordColumns=new Set(db.prepare("PRAGMA table_info(pf_query_records)").all().map((row)=>row.name));
  for(const [name,definition] of [["driver_name","TEXT NOT NULL DEFAULT ''"],["payment_type","TEXT NOT NULL DEFAULT ''"],["payment_method","TEXT NOT NULL DEFAULT ''"],["reference_id","TEXT NOT NULL DEFAULT ''"],["gross_profit","REAL NOT NULL DEFAULT 0"]]){
    if(!recordColumns.has(name)) db.exec(`ALTER TABLE pf_query_records ADD COLUMN ${name} ${definition}`);
  }
  // Some pre-v7 databases have the catalog table but no projection-meta rows.
  // In that state the version-based reset above cannot identify the legacy
  // schema, so CREATE TABLE IF NOT EXISTS leaves the old table unchanged and
  // the rebuild fails when it writes the new record location fields.
  const catalogColumns=new Set(db.prepare("PRAGMA table_info(pf_catalog_search)").all().map((row)=>row.name));
  for(const [name,definition] of [["chunk_index","INTEGER NOT NULL DEFAULT 0"],["ordinal","INTEGER NOT NULL DEFAULT 0"]]){
    if(!catalogColumns.has(name)) db.exec(`ALTER TABLE pf_catalog_search ADD COLUMN ${name} ${definition}`);
  }
  const metaColumns=new Set(db.prepare("PRAGMA table_info(pf_query_projection_meta)").all().map((row)=>row.name));
  for(const [name,definition] of [["sum_total","REAL NOT NULL DEFAULT 0"],["sum_paid","REAL NOT NULL DEFAULT 0"],["sum_remaining","REAL NOT NULL DEFAULT 0"],["sum_overpayment","REAL NOT NULL DEFAULT 0"],["sum_receivable","REAL NOT NULL DEFAULT 0"],["outstanding_count","INTEGER NOT NULL DEFAULT 0"],["outstanding_total","REAL NOT NULL DEFAULT 0"],["outstanding_paid","REAL NOT NULL DEFAULT 0"],["outstanding_remaining","REAL NOT NULL DEFAULT 0"]]){
    if(!metaColumns.has(name)) db.exec(`ALTER TABLE pf_query_projection_meta ADD COLUMN ${name} ${definition}`);
  }
}

function canonicalState(db, entity) {
  const base = `${STORE_PREFIX}${entity}`;
  const meta = db.prepare("SELECT value, updated_at FROM kv_store WHERE key = ?").get(`${base}#meta`);
  const plain = db.prepare("SELECT value, updated_at FROM kv_store WHERE key = ?").get(base);
  if (plain && plain.value !== TOMBSTONE) {
    let parsed;
    try { parsed = JSON.parse(plain.value); } catch { parsed = []; }
    return { updatedAt: plain.updated_at || "", count: Array.isArray(parsed) ? parsed.length : 0, plain: parsed };
  }
  if (!meta) return { updatedAt: plain?.updated_at || "", count: 0, chunks: 0 };
  let value = {};
  try { value = JSON.parse(meta.value); } catch { /* invalid meta is rejected below */ }
  const chunks = Number(value.chunks);
  const count = Number(value.total);
  if (!Number.isInteger(chunks) || chunks < 0 || !Number.isInteger(count) || count < 0) {
    throw new Error(`invalid_projection_source_meta:${entity}`);
  }
  return { updatedAt: meta.updated_at || "", count, chunks };
}

function text(value) { return typeof value === "string" ? value : ""; }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function recordSearchText(entity, row, config) {
  if (!SEARCH_ENTITIES.has(entity)) return "";
  const values = [
    row.id, row[config.number], row[config.partyName], row.vehicleLabel,
    row.branchName, row.referenceId, row.originalInvoiceNumber, row.notes,
  ];
  return values.filter(Boolean).join(" \u0001 ").toLocaleLowerCase("en");
}

function catalogSearchText(row) {
  return [row.id,row.name,row.code,row.phone,row.barcode,row.partNumber,row.partBrand,row.manufacturer,row.vehicleLabel,...(Array.isArray(row.oemNumbers)?row.oemNumbers:[])]
    .filter(Boolean).join(" \u0001 ").toLocaleLowerCase("en");
}

function visitCanonical(db, entity, visitor) {
  const source=canonicalState(db,entity);
  if(Array.isArray(source.plain)){for(const row of source.plain) visitor(row);return;}
  const get=db.prepare("SELECT value FROM kv_store WHERE key=?");
  for(let index=0;index<source.chunks;index+=1){
    const raw=get.get(`${STORE_PREFIX}${entity}#${String(index).padStart(4,"0")}`)?.value;
    const rows=JSON.parse(raw||"[]");
    for(const row of rows) visitor(row);
  }
}

function rowArgs(entity, row, chunkIndex, ordinal) {
  const config = ENTITY_CONFIG[entity] || {};
  const paid = entity === "salesInvoices" ? row.amountReceived : entity === "purchaseInvoices" ? row.amountPaid : row.amount;
  return {
    entity,
    id: text(row.id || row.clientOpId || `${chunkIndex}:${ordinal}`),
    chunkIndex,
    ordinal,
    date: text(row.date || row.createdAt),
    number: text(row[config.number]),
    partyId: text(row[config.partyId]),
    partyName: text(row[config.partyName]),
    driverName: text(row.driverName || (entity === "quotations" ? row.vehicleLabel : row.originalInvoiceNumber)), status: text(row.status || row.type),
    paymentType: text(row.paymentType || (entity === "salesReturns" ? (row.refundCash ? "cash" : "credit") : "")), paymentMethod: text(row.paymentMethod || (entity === "quotations" ? row.priceTierName : "")),
    branchId: text(row.branchId),
    dueDate: text(row.paymentDueDate || row.dueDate || row.validUntil),
    referenceId: text(row.originalInvoiceId || row.referenceId),
    cancelled: row.cancelled ? 1 : 0,
    archived: row.archived ? 1 : 0,
    collectOnDelivery: row.collectOnDelivery ? 1 : 0,
    total: num(row.total), paid: num(paid), remaining: num(row.remaining),
    overpayment: num(row.overpayment), discount: num(row.discount), quantity: num(row.quantity),
    grossProfit: Array.isArray(row.lines)
      ? row.lines.reduce((sum, line) => sum + num(line.subtotal) - num(line.costPrice) * num(line.quantity), 0) - num(row.discount)
      : 0,
    searchText: recordSearchText(entity, row, config),
  };
}

function statements(db) {
  const insertRecord = db.prepare(`
    INSERT INTO pf_query_records (
      entity,id,chunk_index,ordinal,date,number,party_id,party_name,driver_name,status,payment_type,payment_method,branch_id,due_date,reference_id,
      cancelled,archived,collect_on_delivery,total,paid,remaining,overpayment,discount,quantity,gross_profit,search_text
    ) VALUES (
      @entity,@id,@chunkIndex,@ordinal,@date,@number,@partyId,@partyName,@driverName,@status,@paymentType,@paymentMethod,@branchId,@dueDate,@referenceId,
      @cancelled,@archived,@collectOnDelivery,@total,@paid,@remaining,@overpayment,@discount,@quantity,@grossProfit,@searchText
    ) ON CONFLICT(entity,id) DO UPDATE SET
      chunk_index=excluded.chunk_index,ordinal=excluded.ordinal,date=excluded.date,number=excluded.number,
      party_id=excluded.party_id,party_name=excluded.party_name,driver_name=excluded.driver_name,status=excluded.status,
      payment_type=excluded.payment_type,payment_method=excluded.payment_method,branch_id=excluded.branch_id,
      due_date=excluded.due_date,reference_id=excluded.reference_id,cancelled=excluded.cancelled,archived=excluded.archived,
      collect_on_delivery=excluded.collect_on_delivery,total=excluded.total,paid=excluded.paid,
      remaining=excluded.remaining,overpayment=excluded.overpayment,discount=excluded.discount,
      quantity=excluded.quantity,gross_profit=excluded.gross_profit,search_text=excluded.search_text
  `);
  const insertStock = db.prepare(`INSERT INTO pf_stock_movements(id,chunk_index,ordinal,date,product_id,movement_type,quantity,reference_id)
    VALUES(@id,@chunkIndex,@ordinal,@date,@productId,@movementType,@quantity,@referenceId)
    ON CONFLICT(id) DO UPDATE SET chunk_index=excluded.chunk_index,ordinal=excluded.ordinal,date=excluded.date,
      product_id=excluded.product_id,movement_type=excluded.movement_type,
      quantity=excluded.quantity,reference_id=excluded.reference_id`);
  const addDaily = db.prepare(`INSERT INTO pf_dashboard_daily(entity,date,total,profit,discount) VALUES(?,?,?,?,?)
    ON CONFLICT(entity,date) DO UPDATE SET total=total+excluded.total,profit=profit+excluded.profit,discount=discount+excluded.discount`);
  const addProductDaily = db.prepare(`INSERT INTO pf_dashboard_product_daily(entity,date,product_id,product_name,revenue) VALUES(?,?,?,?,?)
    ON CONFLICT(entity,date,product_id) DO UPDATE SET product_name=excluded.product_name,revenue=revenue+excluded.revenue`);
  const insertCatalog = db.prepare(`INSERT INTO pf_catalog_search(entity,id,chunk_index,ordinal,name,code,phone,archived) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(entity,id) DO UPDATE SET chunk_index=excluded.chunk_index,ordinal=excluded.ordinal,name=excluded.name,code=excluded.code,phone=excluded.phone,archived=excluded.archived`);
  const addDue = db.prepare(`INSERT INTO pf_due_daily(due_date,invoice_count,remaining_total) VALUES(?,?,?)
    ON CONFLICT(due_date) DO UPDATE SET invoice_count=invoice_count+excluded.invoice_count,remaining_total=remaining_total+excluded.remaining_total`);
  return { insertRecord, insertStock, addDaily, addProductDaily, insertCatalog, addDue };
}

function addDashboardContribution(db, prepared, entity, row, direction = 1) {
  if(entity==="cashEntries"){const cashDate=text(row.date).slice(0,10);if(cashDate)prepared.addDaily.run(entity,cashDate,direction*num(row.amount),0,0);return;}
  if (!["salesInvoices", "purchaseInvoices", "salesReturns"].includes(entity) || row.cancelled) return;
  if (entity === "salesReturns" && row.originalInvoiceId) {
    const original=db.prepare("SELECT cancelled FROM pf_query_records WHERE entity='salesInvoices' AND id=?").get(text(row.originalInvoiceId));
    if (original?.cancelled) return;
  }
  const date = text(row.date).slice(0, 10);
  if (!date) return;
  const profit = Array.isArray(row.lines)
    ? row.lines.reduce((sum, line) => sum + num(line.subtotal) - num(line.costPrice) * num(line.quantity), 0) - num(row.discount)
    : 0;
  prepared.addDaily.run(entity, date, direction * num(row.total), direction * profit, direction * num(row.discount));
  if(entity==="salesInvoices"&&num(row.remaining)>0){const dueDate=text(row.paymentDueDate||row.dueDate).slice(0,10);if(dueDate)prepared.addDue.run(dueDate,direction,direction*num(row.remaining));}
  if (entity === "purchaseInvoices" || date < PRODUCT_DAILY_CUTOFF) return;
  const byProduct = new Map();
  for (const line of Array.isArray(row.lines) ? row.lines : []) {
    const productId = text(line.productId);
    if (!productId) continue;
    const current = byProduct.get(productId) || { name: text(line.productName), revenue: 0 };
    current.revenue += direction * num(line.subtotal);
    byProduct.set(productId, current);
  }
  for (const [productId, value] of byProduct) prepared.addProductDaily.run(entity, date, productId, value.name, value.revenue);
}

function insertRows(db, entity, rows, chunkIndex, prepared = statements(db), ordinalBase = 0) {
  if (!Array.isArray(rows)) throw new Error(`invalid_projection_source_chunk:${entity}:${chunkIndex}`);
  for (let localOrdinal = 0; localOrdinal < rows.length; localOrdinal += 1) {
    const ordinal = ordinalBase + localOrdinal;
    const row = rows[localOrdinal] || {};
    const args = rowArgs(entity, row, chunkIndex, ordinal);
    if (!args.id) throw new Error(`projection_record_without_id:${entity}`);
    if (entity === "stockMovements") prepared.insertStock.run({
      id: args.id, chunkIndex, ordinal, date: args.date, productId: args.partyId,
      productName: args.partyName, movementType: args.status, quantity: args.quantity,
      referenceId: args.number || args.referenceId,
    });
    else if (CATALOG_ENTITIES.has(entity)) prepared.insertCatalog.run(entity,args.id,chunkIndex,ordinal,text(row.name),text(row.code),text(row.phone),args.archived);
    else if (!META_ONLY_ENTITIES.has(entity)) prepared.insertRecord.run(args);
    addDashboardContribution(db, prepared, entity, row, 1);
  }
}

function rebuildEntity(db, entity, options = {}) {
  if (!ENTITY_CONFIG[entity]) throw new Error("unsupported_projection_entity");
  createSchema(db);
  const source = canonicalState(db, entity);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM pf_query_records WHERE entity = ?").run(entity);
    if (CATALOG_ENTITIES.has(entity)) db.prepare("DELETE FROM pf_catalog_search WHERE entity=?").run(entity);
    if (entity === "stockMovements") db.prepare("DELETE FROM pf_stock_movements").run();
    db.prepare("DELETE FROM pf_dashboard_daily WHERE entity = ?").run(entity);
    db.prepare("DELETE FROM pf_dashboard_product_daily WHERE entity = ?").run(entity);
    if(entity==="salesInvoices")db.prepare("DELETE FROM pf_due_daily").run();
    const prepared = statements(db);
    if (Array.isArray(source.plain)) {
      insertRows(db, entity, source.plain, 0, prepared);
    } else {
      const base = `${STORE_PREFIX}${entity}`;
      const getChunk = db.prepare("SELECT value FROM kv_store WHERE key = ?");
      let inserted = 0;
      for (let index = 0; index < source.chunks; index += 1) {
        const key = `${base}#${String(index).padStart(4, "0")}`;
        const raw = getChunk.get(key)?.value;
        if (raw == null) throw new Error(`missing_projection_source_chunk:${entity}:${index}`);
        let rows;
        try { rows = JSON.parse(raw); } catch { throw new Error(`invalid_projection_source_chunk:${entity}:${index}`); }
        insertRows(db, entity, rows, index, prepared);
        inserted += rows.length;
        options.onProgress?.({ entity, chunk: index + 1, chunks: source.chunks, entityProcessed: inserted, entityTotal: source.count });
      }
      if (inserted !== source.count) throw new Error(`projection_source_count_mismatch:${entity}`);
    }
    if(entity === "salesInvoices" || entity === "purchaseInvoices"){
      db.prepare("DELETE FROM pf_party_balances WHERE entity=?").run(entity);
      db.prepare(`INSERT INTO pf_party_balances(entity,party_id,party_name,balance,open_invoices,last_activity)
        SELECT entity,party_id,MAX(party_name),SUM(CASE WHEN cancelled=0 THEN remaining-overpayment ELSE 0 END),
          SUM(CASE WHEN cancelled=0 AND remaining>0 THEN 1 ELSE 0 END),MAX(CASE WHEN cancelled=0 THEN date ELSE '' END)
        FROM pf_query_records WHERE entity=? AND party_id<>'' GROUP BY entity,party_id
        HAVING ABS(SUM(CASE WHEN cancelled=0 THEN remaining-overpayment ELSE 0 END))>=0.005
          OR SUM(CASE WHEN cancelled=0 AND remaining>0 THEN 1 ELSE 0 END)>0`).run(entity);
    }
    const projected = entity === "stockMovements"
      ? db.prepare("SELECT COUNT(*) AS count FROM pf_stock_movements").get().count
      : CATALOG_ENTITIES.has(entity) || META_ONLY_ENTITIES.has(entity)
        ? source.count
        : db.prepare("SELECT COUNT(*) AS count FROM pf_query_records WHERE entity = ?").get(entity).count;
    if (projected !== source.count) throw new Error(`projection_count_mismatch:${entity}`);
    const sums = entity === "cashEntries"
      ? { sumTotal: 0, sumPaid: num(db.prepare("SELECT SUM(total) value FROM pf_dashboard_daily WHERE entity='cashEntries'").get()?.value), sumRemaining: 0, sumOverpayment: 0, sumReceivable: 0, outstandingCount: 0, outstandingTotal: 0, outstandingPaid: 0, outstandingRemaining: 0 }
      : CATALOG_ENTITIES.has(entity) || entity === "stockMovements" || entity === "mobileStockOpReceipts"
      ? { sumTotal: 0, sumPaid: 0, sumRemaining: 0, sumOverpayment: 0, sumReceivable: 0, outstandingCount: 0, outstandingTotal: 0, outstandingPaid: 0, outstandingRemaining: 0 }
      : db.prepare("SELECT COALESCE(SUM(CASE WHEN cancelled=0 THEN total ELSE 0 END),0) sumTotal,COALESCE(SUM(CASE WHEN cancelled=0 THEN paid ELSE 0 END),0) sumPaid,COALESCE(SUM(CASE WHEN cancelled=0 THEN remaining ELSE 0 END),0) sumRemaining,COALESCE(SUM(CASE WHEN cancelled=0 THEN overpayment ELSE 0 END),0) sumOverpayment,COALESCE(SUM(CASE WHEN cancelled=0 AND collect_on_delivery=0 THEN remaining-overpayment ELSE 0 END),0) sumReceivable,COALESCE(SUM(CASE WHEN cancelled=0 AND remaining>0 THEN 1 ELSE 0 END),0) outstandingCount,COALESCE(SUM(CASE WHEN cancelled=0 AND remaining>0 THEN total ELSE 0 END),0) outstandingTotal,COALESCE(SUM(CASE WHEN cancelled=0 AND remaining>0 THEN paid ELSE 0 END),0) outstandingPaid,COALESCE(SUM(CASE WHEN cancelled=0 AND remaining>0 THEN remaining ELSE 0 END),0) outstandingRemaining FROM pf_query_records WHERE entity=?").get(entity);
    db.prepare(`
      INSERT INTO pf_query_projection_meta(entity,version,canonical_updated_at,canonical_count,sum_total,sum_paid,sum_remaining,sum_overpayment,sum_receivable,outstanding_count,outstanding_total,outstanding_paid,outstanding_remaining,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(entity) DO UPDATE SET version=excluded.version,
        canonical_updated_at=excluded.canonical_updated_at,canonical_count=excluded.canonical_count,
        sum_total=excluded.sum_total,sum_paid=excluded.sum_paid,sum_remaining=excluded.sum_remaining,
        sum_overpayment=excluded.sum_overpayment,sum_receivable=excluded.sum_receivable,outstanding_count=excluded.outstanding_count,outstanding_total=excluded.outstanding_total,
        outstanding_paid=excluded.outstanding_paid,outstanding_remaining=excluded.outstanding_remaining,
        completed_at=excluded.completed_at
    `).run(entity, VERSION, source.updatedAt, source.count,sums.sumTotal,sums.sumPaid,sums.sumRemaining,sums.sumOverpayment,sums.sumReceivable,sums.outstandingCount,sums.outstandingTotal,sums.outstandingPaid,sums.outstandingRemaining,new Date().toISOString());
  });
  tx.immediate();
  return { entity, count: source.count, updatedAt: source.updatedAt };
}

function ensureEntity(db, entity) {
  const source = canonicalState(db, entity);
  const marker = tableExists(db, "pf_query_projection_meta")
    ? db.prepare("SELECT * FROM pf_query_projection_meta WHERE entity = ?").get(entity)
    : null;
  if (!marker || marker.version !== VERSION || marker.canonical_updated_at !== source.updatedAt || marker.canonical_count !== source.count) {
    throw new Error(`projection_upgrade_required:${entity}`);
  }
  return { entity, count: source.count, updatedAt: source.updatedAt, rebuilt: false };
}

function validateProjection(db, snapshot) {
  for (const source of snapshot) {
    const current = canonicalState(db, source.entity);
    if (current.updatedAt !== source.updatedAt || current.count !== source.count) throw new Error(`projection_source_changed:${source.entity}`);
    if (!entityMarkerIsCurrent(db, source)) throw new Error(`projection_marker_invalid:${source.entity}`);
    const projected = source.entity === "stockMovements"
      ? db.prepare("SELECT COUNT(*) count FROM pf_stock_movements").get().count
      : CATALOG_ENTITIES.has(source.entity) || META_ONLY_ENTITIES.has(source.entity)
        ? source.count
        : db.prepare("SELECT COUNT(*) count FROM pf_query_records WHERE entity=?").get(source.entity).count;
    if (projected !== source.count) throw new Error(`projection_validation_count_mismatch:${source.entity}`);
  }
  return true;
}

function runUpgrade(db, options = {}) {
  const runId = options.runId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = new Date().toISOString();
  let snapshot = projectionSourceSnapshot(db);
  const totalRecords = snapshot.reduce((sum, row) => sum + row.count, 0);
  let processedRecords = 0;
  let lastPercent = -1;
  let lastPersistedState = "";
  let lastPersistedEntity = "";
  const emit = (state, percent, detail = {}) => {
    const monotonicPercent = Math.max(lastPercent, Math.min(100, Math.round(percent * 10) / 10));
    lastPercent = monotonicPercent;
    const payload = { state, percent: monotonicPercent, processedRecords, totalRecords, ...detail };
    const entityFinished = detail.entity && detail.entityProcessed === detail.entityTotal && detail.entity !== lastPersistedEntity;
    if (state !== lastPersistedState || entityFinished) {
      writeUpgradeState(db, { state, runId, processedRecords, totalRecords, stageDetail: detail.entity || detail.detail || "", startedAt });
      lastPersistedState = state;
      if (entityFinished) lastPersistedEntity = detail.entity;
    }
    options.onProgress?.(payload);
  };
  try {
    createControlSchema(db);
    db.prepare("DELETE FROM pf_projection_completion").run();
    emit("PREPARING", 1, { detail: "schema" });
    createSchema(db);
    snapshot = projectionSourceSnapshot(db);
    const pending = snapshot.filter((source) => !entityMarkerIsCurrent(db, source));
    processedRecords = snapshot.filter((source) => entityMarkerIsCurrent(db, source)).reduce((sum, row) => sum + row.count, 0);
    emit("BUILDING", 2 + (totalRecords ? 88 * processedRecords / totalRecords : 88), { detail: "projection" });
    for (const source of pending) {
      const beforeEntity = processedRecords;
      rebuildEntity(db, source.entity, {
        onProgress: (progress) => {
          processedRecords = beforeEntity + progress.entityProcessed;
          emit("BUILDING", 2 + (totalRecords ? 88 * processedRecords / totalRecords : 88), progress);
        },
      });
      processedRecords = beforeEntity + source.count;
      emit("BUILDING", 2 + (totalRecords ? 88 * processedRecords / totalRecords : 88), { entity: source.entity, entityProcessed: source.count, entityTotal: source.count });
    }
    emit("VALIDATING", 92, { detail: "counts-and-source-metadata" });
    validateProjection(db, snapshot);
    emit("FINALIZING", 98, { detail: "durable-completion-marker" });
    const signature = sourceSignature(snapshot);
    const completedAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare("INSERT INTO pf_projection_completion(singleton,version,source_signature,completed_at) VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET version=excluded.version,source_signature=excluded.source_signature,completed_at=excluded.completed_at")
        .run(VERSION, signature, completedAt);
      writeUpgradeState(db, { state: "COMPLETE", runId, processedRecords: totalRecords, totalRecords, stageDetail: "complete", startedAt });
    }).immediate();
    processedRecords = totalRecords;
    options.onProgress?.({ state: "COMPLETE", percent: 100, processedRecords, totalRecords, completedAt });
    return { ok: true, state: "COMPLETE", runId, totalRecords, completedAt };
  } catch (error) {
    const errorCode = String(error?.message || "projection_upgrade_failed").slice(0, 240);
    try {
      db.prepare("DELETE FROM pf_projection_completion").run();
      writeUpgradeState(db, { state: "FAILED", runId, processedRecords, totalRecords, stageDetail: "failed", errorCode, startedAt });
    } catch { /* the original error remains authoritative */ }
    options.onProgress?.({ state: "FAILED", percent: Math.max(0, lastPercent), processedRecords, totalRecords, errorCode });
    throw error;
  }
}

function refreshCompletionMarker(db) {
  if (!tableExists(db, "pf_projection_completion")) return;
  const snapshot = projectionSourceSnapshot(db);
  if (!snapshot.every((source) => entityMarkerIsCurrent(db, source))) {
    db.prepare("DELETE FROM pf_projection_completion").run();
    return;
  }
  const marker = db.prepare("SELECT completed_at FROM pf_projection_completion WHERE singleton=1").get();
  if (!marker) return;
  db.prepare("UPDATE pf_projection_completion SET version=?,source_signature=? WHERE singleton=1")
    .run(VERSION, sourceSignature(snapshot));
}

function invalidateChangedEntities(db, entries) {
  if (!entries || typeof entries !== "object") return;
  const changed = new Set();
  for (const key of Object.keys(entries)) {
    for (const entity of Object.keys(ENTITY_CONFIG)) {
      const base = `${STORE_PREFIX}${entity}`;
      if (key === base || key.startsWith(`${base}#`)) changed.add(entity);
    }
  }
  const remove = db.prepare("DELETE FROM pf_query_projection_meta WHERE entity = ?");
  for (const entity of changed) remove.run(entity);
  if (changed.size && tableExists(db, "pf_projection_completion")) db.prepare("DELETE FROM pf_projection_completion").run();
}

// Keep an already-built projection current without rebuilding history.  This
// runs inside the caller's canonical write transaction.  If a write shape is
// not understood, the completion marker is removed in that same transaction;
// subsequent reads rebuild before returning anything, so stale derived rows
// can never be observed as authoritative.
function syncChangedEntitiesLegacy(db, entries) {
  if (!entries || typeof entries !== "object") return;
  for (const entity of Object.keys(ENTITY_CONFIG)) {
    const marker = db.prepare("SELECT * FROM pf_query_projection_meta WHERE entity=?").get(entity);
    if (!marker) continue;
    const base = `${STORE_PREFIX}${entity}`;
    const related = Object.entries(entries).filter(([key]) => key === base || key.startsWith(`${base}#`));
    if (!related.length) continue;
    const plain = related.find(([key, value]) => key === base && value !== TOMBSTONE);
    const chunks = related
      .map(([key, value]) => {
        const match = key.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#(\\d+)$`));
        return match ? { index: Number(match[1]), value } : null;
      })
      .filter(Boolean);
    if (plain || !chunks.length) {
      db.prepare("DELETE FROM pf_query_projection_meta WHERE entity=?").run(entity);
      continue;
    }
    try {
      const prepared = statements(db);
      const delta={total:0,paid:0,remaining:0,overpayment:0,receivable:0,outstandingCount:0,outstandingTotal:0,outstandingPaid:0,outstandingRemaining:0};
      const addContribution=(row,direction)=>{
        if(Number(row.cancelled)) return;
        const total=num(row.total),paid=num(row.paid),remaining=num(row.remaining);
        delta.total+=direction*total;delta.paid+=direction*paid;delta.remaining+=direction*remaining;
        if(remaining>0){delta.outstandingCount+=direction;delta.outstandingTotal+=direction*total;delta.outstandingPaid+=direction*paid;delta.outstandingRemaining+=direction*remaining;}
      };
      for (const chunk of chunks) {
        const rows = JSON.parse(chunk.value);
        if (!Array.isArray(rows)) throw new Error("invalid_incremental_chunk");
        const existingRows=db.prepare("SELECT id,ordinal,content_hash,cancelled,total,paid,remaining FROM pf_query_records WHERE entity=? AND chunk_index=?").all(entity, chunk.index);
        const existing = new Map(existingRows.map((row) => [row.id, row]));
        const nextArgs=rows.map((row,ordinal)=>rowArgs(entity,row||{},chunk.index,ordinal));
        const nextIds = new Set(nextArgs.map((row)=>row.id));
        for (const id of existing.keys()) {
          if (nextIds.has(id)) continue;
          addContribution(existing.get(id),-1);
          db.prepare("DELETE FROM pf_query_lines WHERE entity=? AND record_id=?").run(entity, id);
          db.prepare("DELETE FROM pf_query_records WHERE entity=? AND id=?").run(entity, id);
          if(SEARCH_ENTITIES.has(entity)) db.prepare("DELETE FROM pf_query_search WHERE entity=? AND id=?").run(entity,id);
        }
        for (let ordinal = 0; ordinal < rows.length; ordinal += 1) {
          const row = rows[ordinal] || {};
          const args = nextArgs[ordinal];
          const old = existing.get(args.id);
          if (old?.content_hash === args.contentHash) {
            if (old.ordinal !== ordinal) db.prepare("UPDATE pf_query_records SET ordinal=? WHERE entity=? AND id=?").run(ordinal, entity, args.id);
            continue;
          }
          if (old) {
            addContribution(old,-1);
            db.prepare("DELETE FROM pf_query_lines WHERE entity=? AND record_id=?").run(entity, args.id);
            db.prepare("DELETE FROM pf_query_records WHERE entity=? AND id=?").run(entity, args.id);
            if(SEARCH_ENTITIES.has(entity)) db.prepare("DELETE FROM pf_query_search WHERE entity=? AND id=?").run(entity,args.id);
          }
          insertRows(db, entity, [row], chunk.index, prepared, ordinal);
          addContribution(args,1);
        }
      }
      const source = canonicalState(db, entity);
      const projected = db.prepare("SELECT COUNT(*) count FROM pf_query_records WHERE entity=?").get(entity).count;
      if (projected !== source.count) throw new Error("projection_incremental_count_mismatch");
      db.prepare("UPDATE pf_query_projection_meta SET version=?,canonical_updated_at=?,canonical_count=?,sum_total=sum_total+?,sum_paid=sum_paid+?,sum_remaining=sum_remaining+?,outstanding_count=outstanding_count+?,outstanding_total=outstanding_total+?,outstanding_paid=outstanding_paid+?,outstanding_remaining=outstanding_remaining+?,completed_at=? WHERE entity=?")
        .run(VERSION,source.updatedAt,source.count,delta.total,delta.paid,delta.remaining,delta.outstandingCount,delta.outstandingTotal,delta.outstandingPaid,delta.outstandingRemaining,new Date().toISOString(),entity);
    } catch {
      db.prepare("DELETE FROM pf_query_projection_meta WHERE entity=?").run(entity);
    }
  }
}

function captureChangedEntities(db, entries) {
  const previous = {};
  if (!entries || typeof entries !== "object") return previous;
  const get = db.prepare("SELECT value FROM kv_store WHERE key=?");
  for (const key of Object.keys(entries)) {
    if (key.includes("#") && !key.endsWith("#meta")) previous[key] = get.get(key)?.value;
  }
  return previous;
}

function syncChangedEntities(db, entries, previous = {}) {
  if (!entries || typeof entries !== "object") return;
  for (const entity of Object.keys(ENTITY_CONFIG)) {
    const marker = db.prepare("SELECT * FROM pf_query_projection_meta WHERE entity=?").get(entity);
    if (!marker) continue;
    const base = `${STORE_PREFIX}${entity}`;
    const related = Object.entries(entries).filter(([key]) => key === base || key.startsWith(`${base}#`));
    if (!related.length) continue;
    const chunks = related.map(([key, value]) => {
      const match = key.match(/#(\d+)$/);
      return match ? { key, index: Number(match[1]), value } : null;
    }).filter(Boolean);
    if (!chunks.length || related.some(([key, value]) => key === base && value !== TOMBSTONE)) {
      db.prepare("DELETE FROM pf_query_projection_meta WHERE entity=?").run(entity);
      continue;
    }
    if (CATALOG_ENTITIES.has(entity)) {
      try {
        const prepared = statements(db);
        let projectedCountDelta = 0;
        for (const chunk of chunks) {
          const oldRows = previous[chunk.key] == null ? null : JSON.parse(previous[chunk.key]);
          const nextRows = JSON.parse(chunk.value);
          if (!Array.isArray(oldRows) || !Array.isArray(nextRows)) throw new Error("invalid_catalog_chunk");
          const oldMap = new Map(oldRows.map((row, ordinal) => [text(row?.id), { row, ordinal, json: JSON.stringify(row) }]));
          const nextMap = new Map(nextRows.map((row, ordinal) => [text(row?.id), { row, ordinal, json: JSON.stringify(row) }]));
          for (const [id, old] of oldMap) {
            const next = nextMap.get(id);
            if (next?.json === old.json) {
              if (next.ordinal !== old.ordinal) db.prepare("UPDATE pf_catalog_search SET ordinal=? WHERE entity=? AND id=?").run(next.ordinal, entity, id);
              nextMap.delete(id);
              continue;
            }
            db.prepare("DELETE FROM pf_catalog_search WHERE entity=? AND id=?").run(entity, id);
            projectedCountDelta -= 1;
          }
          for (const { row, ordinal } of nextMap.values()) {
            insertRows(db, entity, [row || {}], chunk.index, prepared, ordinal);
            projectedCountDelta += 1;
          }
        }
        const source = canonicalState(db, entity);
        // The marker was validated before this transaction. Track the exact
        // deletes/inserts performed above instead of rescanning the entire
        // projection after every one-row canonical mutation.
        const projected = Number(marker.canonical_count) + projectedCountDelta;
        if (projected !== source.count) throw new Error("catalog_projection_incremental_count_mismatch");
        db.prepare("UPDATE pf_query_projection_meta SET version=?,canonical_updated_at=?,canonical_count=?,completed_at=? WHERE entity=?")
          .run(VERSION, source.updatedAt, source.count, new Date().toISOString(), entity);
      } catch {
        db.prepare("DELETE FROM pf_query_projection_meta WHERE entity=?").run(entity);
      }
      continue;
    }
    try {
      const prepared = statements(db);
      let projectedCountDelta = 0;
      const delta={total:0,paid:0,remaining:0,overpayment:0,receivable:0,outstandingCount:0,outstandingTotal:0,outstandingPaid:0,outstandingRemaining:0};
      const partyDeltas=new Map();
      const addFinancial=(row,direction)=>{
        const args=rowArgs(entity,row||{},0,0);
        if(args.cancelled) return;
        delta.total+=direction*args.total;delta.paid+=direction*args.paid;delta.remaining+=direction*args.remaining;delta.overpayment+=direction*args.overpayment;if(!args.collectOnDelivery)delta.receivable+=direction*(args.remaining-args.overpayment);
        if(args.remaining>0){delta.outstandingCount+=direction;delta.outstandingTotal+=direction*args.total;delta.outstandingPaid+=direction*args.paid;delta.outstandingRemaining+=direction*args.remaining;}
        if((entity==="salesInvoices"||entity==="purchaseInvoices")&&args.partyId){
          const current=partyDeltas.get(args.partyId)||{balance:0,openInvoices:0,partyName:""};
          current.balance+=direction*(args.remaining-args.overpayment);
          current.openInvoices+=direction*(args.remaining>0?1:0);
          if(direction>0&&args.partyName)current.partyName=args.partyName;
          partyDeltas.set(args.partyId,current);
        }
      };
      let salesCancellationChanged=false;
      for (const chunk of chunks) {
        let oldRows;
        if (previous[chunk.key] == null) {
          // Appending to a full canonical tail creates a brand-new chunk. There
          // is intentionally no previous physical row in that case; treating
          // it as an unavailable incremental source invalidated the projection
          // immediately after the boundary sale (for example 201000 -> 201001).
          // Only accept the exact first chunk beyond the marker's prior count.
          // A missing row anywhere inside the prior manifest is still treated
          // as corruption and invalidates the projection below.
          const previousChunks = Math.ceil(Number(marker.canonical_count) / 500);
          const opensAppendChunk =
            Number(marker.canonical_count) % 500 === 0 &&
            chunk.index === previousChunks;
          if (!opensAppendChunk) throw new Error("incremental_source_unavailable");
          oldRows = [];
        } else {
          oldRows = JSON.parse(previous[chunk.key]);
        }
        const nextRows = JSON.parse(chunk.value);
        if (!Array.isArray(oldRows) || !Array.isArray(nextRows)) throw new Error("incremental_source_unavailable");
        const idFor=(row,ordinal)=>text(row?.id||row?.clientOpId||`${chunk.index}:${ordinal}`);
        const oldMap=new Map(oldRows.map((row,ordinal)=>[idFor(row,ordinal),{row,ordinal,json:JSON.stringify(row)}]));
        const nextMap=new Map(nextRows.map((row,ordinal)=>[idFor(row,ordinal),{row,ordinal,json:JSON.stringify(row)}]));
        for(const [id,old] of oldMap){
          const next=nextMap.get(id);
          if(next?.json===old.json){
            if(next.ordinal!==old.ordinal){
              if(entity==="stockMovements")db.prepare("UPDATE pf_stock_movements SET ordinal=? WHERE id=?").run(next.ordinal,id);
              else if(!CATALOG_ENTITIES.has(entity)&&!META_ONLY_ENTITIES.has(entity))db.prepare("UPDATE pf_query_records SET ordinal=? WHERE entity=? AND id=?").run(next.ordinal,entity,id);
            }
            nextMap.delete(id);continue;
          }
          if(entity==="salesInvoices"&&Boolean(old.row?.cancelled)!==Boolean(next?.row?.cancelled))salesCancellationChanged=true;
          addDashboardContribution(db,prepared,entity,old.row||{},-1);addFinancial(old.row,-1);
          if(entity==="stockMovements")db.prepare("DELETE FROM pf_stock_movements WHERE id=?").run(id);
          else if(!CATALOG_ENTITIES.has(entity)&&!META_ONLY_ENTITIES.has(entity))db.prepare("DELETE FROM pf_query_records WHERE entity=? AND id=?").run(entity,id);
          if(!META_ONLY_ENTITIES.has(entity))projectedCountDelta-=1;
        }
        for(const {row,ordinal} of nextMap.values()){
          insertRows(db,entity,[row],chunk.index,prepared,ordinal);addFinancial(row,1);
          if(!META_ONLY_ENTITIES.has(entity))projectedCountDelta+=1;
        }
      }
      if(entity==="salesInvoices"||entity==="purchaseInvoices"){
        const getBalance=db.prepare("SELECT party_name,balance,open_invoices FROM pf_party_balances WHERE entity=? AND party_id=?");
        const latestParty=db.prepare("SELECT party_name,date FROM pf_query_records WHERE entity=? AND party_id=? AND cancelled=0 ORDER BY date DESC,id DESC LIMIT 1");
        const upsertParty=db.prepare(`INSERT INTO pf_party_balances(entity,party_id,party_name,balance,open_invoices,last_activity) VALUES(?,?,?,?,?,?)
          ON CONFLICT(entity,party_id) DO UPDATE SET party_name=excluded.party_name,balance=excluded.balance,open_invoices=excluded.open_invoices,last_activity=excluded.last_activity`);
        const removeParty=db.prepare("DELETE FROM pf_party_balances WHERE entity=? AND party_id=?");
        for(const [party,change] of partyDeltas){
          const existing=getBalance.get(entity,party);
          const balance=num(existing?.balance)+change.balance;
          const openInvoices=Math.max(0,Math.round(num(existing?.open_invoices)+change.openInvoices));
          if(Math.abs(balance)<0.005&&openInvoices===0){removeParty.run(entity,party);continue;}
          const latest=latestParty.get(entity,party);
          upsertParty.run(entity,party,text(latest?.party_name||change.partyName||existing?.party_name),balance,openInvoices,text(latest?.date));
        }
      }
      db.prepare("DELETE FROM pf_dashboard_daily WHERE ABS(total)<0.000001 AND ABS(profit)<0.000001 AND ABS(discount)<0.000001").run();
      db.prepare("DELETE FROM pf_dashboard_product_daily WHERE ABS(revenue)<0.000001").run();
      db.prepare("DELETE FROM pf_due_daily WHERE invoice_count=0 AND ABS(remaining_total)<0.000001").run();
      const source = canonicalState(db, entity);
      const projected = META_ONLY_ENTITIES.has(entity)
        ? source.count
        : Number(marker.canonical_count) + projectedCountDelta;
      if (projected !== source.count) throw new Error("projection_incremental_count_mismatch");
      db.prepare("UPDATE pf_query_projection_meta SET version=?,canonical_updated_at=?,canonical_count=?,sum_total=sum_total+?,sum_paid=sum_paid+?,sum_remaining=sum_remaining+?,sum_overpayment=sum_overpayment+?,sum_receivable=sum_receivable+?,outstanding_count=outstanding_count+?,outstanding_total=outstanding_total+?,outstanding_paid=outstanding_paid+?,outstanding_remaining=outstanding_remaining+?,completed_at=? WHERE entity=?")
        .run(VERSION,source.updatedAt,source.count,delta.total,delta.paid,delta.remaining,delta.overpayment,delta.receivable,delta.outstandingCount,delta.outstandingTotal,delta.outstandingPaid,delta.outstandingRemaining,new Date().toISOString(),entity);
      if(entity==="salesInvoices"&&salesCancellationChanged)rebuildEntity(db,"salesReturns");
    } catch {
      db.prepare("DELETE FROM pf_query_projection_meta WHERE entity=?").run(entity);
    }
  }
  refreshCompletionMarker(db);
}

function clampPage(input) {
  const page = Math.max(0, Math.min(1000000, Number.parseInt(input?.page, 10) || 0));
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(input?.pageSize, 10) || 30));
  return { page, pageSize };
}

function filtersFor(entity, input = {}) {
  const clauses = ["entity = @entity"];
  const params = { entity };
  const q = text(input.q).trim().toLocaleLowerCase("en");
  if (q) {
    clauses.push("search_text LIKE @q ESCAPE '\\'"); params.q = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  }
  if (input.partyId) { clauses.push("party_id = @partyId"); params.partyId = text(input.partyId); }
  if (input.status === "overpaid") clauses.push("status = 'paid' AND overpayment > 0");
  else if (input.status) { clauses.push("status = @status"); params.status = text(input.status); }
  if (input.branchId) { clauses.push("branch_id = @branchId"); params.branchId = text(input.branchId); }
  if (input.payment === "account") clauses.push("payment_type = 'account'");
  else if (input.payment) { clauses.push("payment_method = @payment"); params.payment = text(input.payment); }
  if (input.refundMode) { clauses.push("payment_type = @refundMode"); params.refundMode = text(input.refundMode); }
  if (input.from) { clauses.push("date >= @from"); params.from = text(input.from); }
  if (input.to) { clauses.push("date <= @toEnd"); params.toEnd = `${text(input.to)}\uffff`; }
  if (input.dueFrom) { clauses.push("due_date >= @dueFrom"); params.dueFrom = text(input.dueFrom); }
  if (input.dueTo) { clauses.push("due_date <= @dueToEnd"); params.dueToEnd = `${text(input.dueTo)}\uffff`; }
  if (input.minAmount != null && input.minAmount !== "") { clauses.push("remaining >= @minAmount"); params.minAmount = num(input.minAmount); }
  if (input.maxAmount != null && input.maxAmount !== "") { clauses.push("remaining <= @maxAmount"); params.maxAmount = num(input.maxAmount); }
  if (input.type) { clauses.push("status = @type"); params.type = text(input.type); }
  if (input.outstanding) clauses.push("cancelled = 0 AND remaining > 0");
  return { where: clauses.join(" AND "), params };
}

function summaryToObject(row, entity) {
  const common = { id: row.id, date: row.date, status: row.status, branchId: row.branch_id || undefined };
  if (entity === "salesInvoices") return { ...common, invoiceNumber: row.number, customerId: row.party_id, customerName: row.party_name, driverName: row.driver_name || undefined, paymentType: row.payment_type, paymentMethod: row.payment_method || undefined, total: row.total, amountReceived: row.paid, remaining: row.remaining, overpayment: row.overpayment, cancelled: Boolean(row.cancelled), lines: [] };
  if (entity === "purchaseInvoices") return { ...common, invoiceNumber: row.number, supplierId: row.party_id, supplierName: row.party_name, total: row.total, amountPaid: row.paid, remaining: row.remaining, overpayment: row.overpayment, lines: [] };
  if (entity === "stockMovements") return { ...common, productId: row.party_id, productName: row.party_name, type: row.status, quantity: row.quantity, referenceId: row.number || undefined };
  if (entity === "salesReturns") return { ...common, returnNumber: row.number, customerId: row.party_id, customerName: row.party_name, originalInvoiceId: row.reference_id, originalInvoiceNumber: row.driver_name, total: row.total, refundCash: row.payment_type === "cash", lines: [] };
  if (entity === "purchaseReturns") return { ...common, returnNumber: row.number, supplierId: row.party_id, supplierName: row.party_name, originalInvoiceId: row.reference_id, originalInvoiceNumber: row.driver_name, total: row.total, lines: [] };
  if (entity === "quotations") return { ...common, quotationNumber: row.number, customerId: row.party_id, customerName: row.party_name, vehicleLabel: row.driver_name || undefined, validUntil: row.due_date || undefined, priceTierName: row.payment_method || undefined, total: row.total, lines: [] };
  return { ...common, number: row.number, partyId: row.party_id, partyName: row.party_name, total: row.total, remaining: row.remaining, archived: Boolean(row.archived) };
}

function queryPage(db, entity, input = {}) {
  const ensured = ensureEntity(db, entity);
  const { page, pageSize } = clampPage(input);
  if (entity === "stockMovements") {
    ensureEntity(db,"products");
    const clauses=[]; const params={};
    if(input.partyId){clauses.push("product_id=@partyId");params.partyId=text(input.partyId);}
    if(input.type){clauses.push("movement_type=@type");params.type=text(input.type);}
    if(input.from){clauses.push("date>=@from");params.from=text(input.from);}
    if(input.to){clauses.push("date<=@toEnd");params.toEnd=`${text(input.to)}\uffff`;}
    const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"";
    const total=clauses.length?db.prepare(`SELECT COUNT(*) count FROM pf_stock_movements ${where}`).get(params).count:ensured.count;
    const rows=db.prepare(`SELECT m.*,c.name product_name FROM pf_stock_movements m LEFT JOIN pf_catalog_search c ON c.entity='products' AND c.id=m.product_id ${where} ORDER BY m.date DESC,m.id DESC LIMIT @limit OFFSET @offset`).all({...params,limit:pageSize,offset:page*pageSize});
    return {rows:rows.map((row)=>({id:row.id,date:row.date,productId:row.product_id,productName:row.product_name||row.product_id,type:row.movement_type,quantity:row.quantity,referenceId:row.reference_id||undefined})),page,pageSize,total,totals:{total:0,paid:0,remaining:0}};
  }
  const { where, params } = filtersFor(entity, input);
  const order = input.sort === "amountDesc" ? "remaining DESC,id DESC"
    : input.sort === "amountAsc" ? "remaining ASC,id ASC"
      : input.sort === "dateAsc" ? "date ASC,id ASC"
        : input.sort === "nameAsc" ? "party_name COLLATE NOCASE ASC,id ASC"
          : "date DESC, id DESC";
  const financial = entity === "salesInvoices" || entity === "purchaseInvoices";
  // On large statements the WITHOUT ROWID primary key can win the planner
  // estimate and scan every invoice. The existing party/date index narrows
  // the aggregate and page to one customer or supplier.
  const recordsSource = input.partyId
    ? "pf_query_records INDEXED BY idx_pf_records_entity_party_date"
    : "pf_query_records";
  const unfiltered = !input.q && !input.partyId && !input.status && !input.payment && !input.refundMode && !input.branchId && !input.from && !input.to && !input.dueFrom && !input.dueTo && input.minAmount == null && input.maxAmount == null && !input.type && !input.outstanding;
  const outstandingOnly = Boolean(input.outstanding) && !input.q && !input.partyId && !input.status && !input.payment && !input.branchId && !input.from && !input.to && !input.dueFrom && !input.dueTo && input.minAmount == null && input.maxAmount == null && !input.type;
  const marker=(financial&&(unfiltered||outstandingOnly))?db.prepare("SELECT * FROM pf_query_projection_meta WHERE entity=?").get(entity):null;
  const count = marker
    ? outstandingOnly
      ? {count:marker.outstanding_count,total:marker.outstanding_total,paid:marker.outstanding_paid,remaining:marker.outstanding_remaining}
      : {count:marker.canonical_count,total:marker.sum_total,paid:marker.sum_paid,remaining:marker.sum_remaining}
    : !financial && unfiltered
      ? { count: ensured.count, total: 0, paid: 0, remaining: 0 }
    : db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN cancelled=0 THEN total ELSE 0 END),0) AS total, COALESCE(SUM(CASE WHEN cancelled=0 THEN paid ELSE 0 END),0) AS paid, COALESCE(SUM(CASE WHEN cancelled=0 THEN remaining ELSE 0 END),0) AS remaining FROM ${recordsSource} WHERE ${where}`).get(params);
  const rows = db.prepare(`SELECT * FROM ${recordsSource} WHERE ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`).all({ ...params, limit: pageSize, offset: page * pageSize });
  let facets;
  if(entity === "quotations" && unfiltered){
    const today=new Date().toISOString().slice(0,10);
    facets=db.prepare("SELECT SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) draft,SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END) converted,SUM(CASE WHEN status='draft' AND due_date<>'' AND due_date<? THEN 1 ELSE 0 END) expired FROM pf_query_records WHERE entity='quotations'").get(today);
  }
  return { rows: rows.map((row) => summaryToObject(row, entity)), page, pageSize, total: count.count, totals: { total: count.total, paid: count.paid, remaining: count.remaining }, facets };
}

function recordDetail(db, entity, id) {
  ensureEntity(db, entity);
  const loc = CATALOG_ENTITIES.has(entity)
    ? db.prepare("SELECT chunk_index, ordinal FROM pf_catalog_search WHERE entity = ? AND id = ?").get(entity, text(id))
    : entity === "stockMovements"
    ? db.prepare("SELECT chunk_index, ordinal FROM pf_stock_movements WHERE id = ?").get(text(id))
    : db.prepare("SELECT chunk_index, ordinal FROM pf_query_records WHERE entity = ? AND id = ?").get(entity, text(id));
  if (!loc) return null;
  const base = `${STORE_PREFIX}${entity}`;
  const plain = db.prepare("SELECT value FROM kv_store WHERE key = ?").get(base)?.value;
  let rows;
  if (plain && plain !== TOMBSTONE) rows = JSON.parse(plain);
  else {
    const key = `${base}#${String(loc.chunk_index).padStart(4, "0")}`;
    const raw = db.prepare("SELECT value FROM kv_store WHERE key = ?").get(key)?.value;
    if (raw == null) throw new Error("projection_detail_chunk_missing");
    rows = JSON.parse(raw);
  }
  const candidate = Array.isArray(rows) ? rows[loc.ordinal] : null;
  if (candidate?.id === id || candidate?.clientOpId === id) return candidate;
  // Defensive recovery for a stale location: never return the wrong record.
  const found = Array.isArray(rows) ? rows.find((row) => row?.id === id || row?.clientOpId === id) : null;
  if (found) return found;
  db.prepare("DELETE FROM pf_query_projection_meta WHERE entity = ?").run(entity);
  ensureEntity(db, entity);
  return recordDetail(db, entity, id);
}

function catalogSearch(db, entity, input = {}) {
  if (!CATALOG_ENTITIES.has(entity)) throw new Error("unsupported_catalog_entity");
  ensureEntity(db, entity);
  if (entity === "customers") ensureEntity(db, "salesInvoices");
  const q = text(input.q).trim().toLocaleLowerCase("en");
  const limit = Math.max(1, Math.min(50, Number.parseInt(input.limit, 10) || 20));
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  const params = { entity, limit, exact: q, prefix: `${escaped}%`, contains: `%${escaped}%` };
  const rows = db.prepare(`SELECT c.id,c.name,c.code,c.phone,
      CASE WHEN c.entity='customers' THEN COALESCE(b.balance,0) ELSE 0 END balance,
      CASE WHEN c.entity='customers' THEN COALESCE(b.open_invoices,0) ELSE 0 END open_invoices
    FROM pf_catalog_search c
    LEFT JOIN pf_party_balances b ON b.entity='salesInvoices' AND b.party_id=c.id
    WHERE c.entity=@entity AND c.archived=0 AND (
      @exact='' OR c.id=@exact COLLATE NOCASE OR c.code LIKE @prefix ESCAPE '\\' COLLATE NOCASE
      OR c.name LIKE @contains ESCAPE '\\' COLLATE NOCASE OR c.phone LIKE @contains ESCAPE '\\')
    ORDER BY CASE WHEN c.id=@exact COLLATE NOCASE OR c.code=@exact COLLATE NOCASE THEN 0
      WHEN c.code LIKE @prefix ESCAPE '\\' COLLATE NOCASE THEN 1 ELSE 2 END,
      c.name COLLATE NOCASE,c.id LIMIT @limit`).all(params);
  return rows.map((row) => ({
    id: row.id, name: row.name, code: row.code || undefined, phone: row.phone || undefined,
    balance: num(row.balance), openInvoices: num(row.open_invoices),
  }));
}

function catalogDetail(db, entity, id) {
  const row = recordDetail(db, entity, id);
  if (!row) return null;
  if (entity !== "customers") return row;
  ensureEntity(db, "salesInvoices");
  const financial = db.prepare("SELECT balance,open_invoices,last_activity FROM pf_party_balances WHERE entity='salesInvoices' AND party_id=?").get(text(id));
  return {
    ...row,
    financialSummary: {
      balance: num(financial?.balance),
      openInvoices: num(financial?.open_invoices),
      lastActivity: financial?.last_activity || undefined,
    },
  };
}

function search(db, input = {}, permissions = {}) {
  const q = text(input.q).trim().toLocaleLowerCase("en");
  if (!q) return [];
  const output = [];
  const quickInvoiceEntities=[["salesInvoices","salesInvoice",permissions.salesInvoices],["purchaseInvoices","purchaseInvoice",permissions.purchaseInvoices],["quotations","quotation",permissions.quotations]].filter(([, , ok])=>ok);
  for(const [entity,kind] of quickInvoiceEntities){ensureEntity(db,entity);const rows=db.prepare("SELECT id,number,party_name,date,status FROM pf_query_records INDEXED BY idx_pf_records_entity_number WHERE entity=? AND number=? COLLATE NOCASE LIMIT 8").all(entity,q);for(const row of rows){const label=row.party_name||row.number||row.id;const subtitle=[row.number&&row.number!==label?row.number:"",row.date].filter(Boolean).join(" · ");const path=kind==="salesInvoice"?`/sales/${row.id}`:kind==="purchaseInvoice"?`/purchases/${row.id}`:`/quotations/${row.id}`;output.push({kind,id:row.id,label,subtitle,to:path});}}
  if(output.length)return output.slice(0,Math.max(1,Math.min(40,Number(input.limit)||30)));
  const catalogAllowed = [["customers","customer",permissions.customers],["suppliers","supplier",permissions.suppliers]].filter(([, , ok])=>ok);
  for(const [entity,kind] of catalogAllowed){
    ensureEntity(db,entity);
    const escaped=q.replace(/[\\%_]/g,"\\$&");
    const indexedRows=db.prepare(`SELECT id,name,code,phone FROM pf_catalog_search WHERE entity=? AND archived=0
      AND (code LIKE ? ESCAPE '\\' COLLATE NOCASE OR name LIKE ? ESCAPE '\\' COLLATE NOCASE OR phone LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN code=? COLLATE NOCASE THEN 0 WHEN code LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 1 ELSE 2 END,name,id LIMIT 8`)
      .all(entity,`${escaped}%`,`%${escaped}%`,`%${escaped}%`,q,`${escaped}%`);
    for(const row of indexedRows){
      const path=kind==="customer"?`/customers/${row.id}`:`/suppliers/${row.id}`;
      output.push({kind,id:row.id,label:row.name||row.code||row.id,subtitle:[row.code,row.phone].filter(Boolean).join(" · "),to:path});
    }
    if(indexedRows.length < 0) {
    visitCanonical(db,entity,(row)=>{
      if(output.filter((item)=>item.kind===kind).length>=8||row?.archived||!catalogSearchText(row).includes(q)) return;
      const label=text(row.name||row.code||row.id); const subtitle=[row.code,row.partNumber,row.phone].filter(Boolean).join(" · ");
      const path=kind==="product"?`/products/${row.id}`:kind==="customer"?`/customers/${row.id}`:`/suppliers/${row.id}`;
      output.push({kind,id:row.id,label,subtitle,to:path});
    });
    }
  }
  // Catalog matches are already the highest-value result for a name, phone or
  // customer/supplier code. Avoid probing all historical invoice prefixes
  // after a complete bounded catalog result has been found.
  if(output.length)return output.slice(0,Math.max(1,Math.min(40,Number(input.limit)||30)));
  const allowed = [
    ["salesInvoices", "salesInvoice", permissions.salesInvoices],
    ["purchaseInvoices", "purchaseInvoice", permissions.purchaseInvoices], ["quotations", "quotation", permissions.quotations],
  ].filter(([, , ok]) => ok);
  let exactInvoiceMatch=false;
  for(const [entity,kind] of allowed){
    ensureEntity(db,entity);
    const rows=db.prepare("SELECT id,number,party_name,date,status FROM pf_query_records INDEXED BY idx_pf_records_entity_number WHERE entity=? AND archived=0 AND number=? COLLATE NOCASE LIMIT 8").all(entity,q);
    for(const row of rows){const label=row.party_name||row.number||row.id;const subtitle=[row.number&&row.number!==label?row.number:"",row.date].filter(Boolean).join(" · ");const path=kind==="salesInvoice"?`/sales/${row.id}`:kind==="purchaseInvoice"?`/purchases/${row.id}`:`/quotations/${row.id}`;output.push({kind,id:row.id,label,subtitle,to:path});exactInvoiceMatch=true;}
  }
  if(!exactInvoiceMatch) for (const [entity, kind] of allowed) {
    ensureEntity(db, entity);
    const escaped=q.replace(/[\\%_]/g,"\\$&");
    const rows = db.prepare(`SELECT id,number,party_name,date,status FROM pf_query_records INDEXED BY idx_pf_records_entity_number
      WHERE entity=? AND number>=? COLLATE NOCASE AND number<? COLLATE NOCASE
        AND archived=0 AND number LIKE ? ESCAPE '\\' COLLATE NOCASE
      ORDER BY CASE WHEN number=? COLLATE NOCASE THEN 0 ELSE 1 END,date DESC,id DESC LIMIT 8`)
      .all(entity,q,`${q}\uffff`,`${escaped}%`,q);
    for (const row of rows) {
      const label = row.party_name || row.number || row.id;
      const subtitle = [row.number && row.number !== label ? row.number : "", row.date].filter(Boolean).join(" \u00b7 ");
      const path = kind === "product" ? `/products/${row.id}` : kind === "customer" ? `/customers/${row.id}` : kind === "supplier" ? `/suppliers/${row.id}` : kind === "salesInvoice" ? `/sales/${row.id}` : kind === "purchaseInvoice" ? `/purchases/${row.id}` : `/quotations/${row.id}`;
      output.push({ kind, id: row.id, label, subtitle, to: path });
    }
  }
  // Preserve the established broad historical search when neither an exact
  // document number nor a catalog row matched. Common customer/supplier and
  // exact-number searches return above without paying for this fallback.
  if(!exactInvoiceMatch&&output.length===0){
    const escaped=q.replace(/[\\%_]/g,"\\$&");
    for(const [entity,kind] of allowed){
      const rows=db.prepare(`SELECT id,number,party_name,date,status FROM pf_query_records WHERE entity=? AND archived=0 AND search_text LIKE ? ESCAPE '\\' ORDER BY date DESC,id DESC LIMIT 8`).all(entity,`%${escaped}%`);
      for(const row of rows){const label=row.party_name||row.number||row.id;const subtitle=[row.number&&row.number!==label?row.number:"",row.date].filter(Boolean).join(" · ");const path=kind==="salesInvoice"?`/sales/${row.id}`:kind==="purchaseInvoice"?`/purchases/${row.id}`:`/quotations/${row.id}`;output.push({kind,id:row.id,label,subtitle,to:path});}
    }
  }
  return output.slice(0, Math.max(1, Math.min(40, Number(input.limit) || 30)));
}

function dashboard(db, permissions, now = new Date()) {
  const profile={};let profileStarted=performance.now();const mark=(name)=>{if(permissions.__profile){profile[name]=Number((performance.now()-profileStarted).toFixed(3));profileStarted=performance.now();}};
  for (const entity of ["salesInvoices", "purchaseInvoices", "salesReturns", "cashEntries", "products"]) ensureEntity(db, entity);
  const retention=new Date(now);retention.setDate(retention.getDate()-120);db.prepare("DELETE FROM pf_dashboard_product_daily WHERE date<?").run(retention.toISOString().slice(0,10));
  mark("ensure");
  const cacheKey = [permissions.sales,permissions.purchases,permissions.cash,permissions.customers,permissions.suppliers].map((value)=>value?"1":"0").join("");
  const projectionToken = db.prepare("SELECT entity,canonical_updated_at,canonical_count FROM pf_query_projection_meta WHERE entity IN ('salesInvoices','purchaseInvoices','salesReturns','cashEntries','products') ORDER BY entity").all()
    .map((row)=>`${row.entity}:${row.canonical_updated_at}:${row.canonical_count}`).join("|");
  const cached = db.prepare("SELECT result_json FROM pf_dashboard_cache WHERE cache_key=? AND projection_token=?").get(cacheKey,projectionToken);
  if(cached){try{return JSON.parse(cached.result_json);}catch{db.prepare("DELETE FROM pf_dashboard_cache WHERE cache_key=?").run(cacheKey);}}
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const today = localDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const cutoffDate = new Date(now); cutoffDate.setDate(cutoffDate.getDate() - 90);
  const cutoff = localDate(cutoffDate);
  const scalar = (sql, args = {}) => num(db.prepare(sql).get(args)?.value);
  const salesWhere = "entity='salesInvoices' AND cancelled=0";
  const validReturns = "r.entity='salesReturns' AND r.cancelled=0 AND NOT EXISTS (SELECT 1 FROM pf_query_records s WHERE s.entity='salesInvoices' AND s.id=r.reference_id AND s.cancelled=1)";
  const todaySales = scalar("SELECT COALESCE(SUM(total),0) value FROM pf_dashboard_daily WHERE entity='salesInvoices' AND date=@d", {d:today}) - scalar("SELECT COALESCE(SUM(total),0) value FROM pf_dashboard_daily WHERE entity='salesReturns' AND date=@d", {d:today});
  const monthlySales = scalar("SELECT COALESCE(SUM(total),0) value FROM pf_dashboard_daily WHERE entity='salesInvoices' AND date>=@d", {d:monthStart}) - scalar("SELECT COALESCE(SUM(total),0) value FROM pf_dashboard_daily WHERE entity='salesReturns' AND date>=@d", {d:monthStart});
  const grossSales = scalar("SELECT COALESCE(SUM(profit),0) value FROM pf_dashboard_daily WHERE entity='salesInvoices' AND date>=@d", {d:monthStart});
  const discounts = 0;
  const grossReturns = scalar("SELECT COALESCE(SUM(profit),0) value FROM pf_dashboard_daily WHERE entity='salesReturns' AND date>=@d", {d:monthStart});
  const salesMeta=db.prepare("SELECT * FROM pf_query_projection_meta WHERE entity='salesInvoices'").get();
  const purchaseMeta=db.prepare("SELECT * FROM pf_query_projection_meta WHERE entity='purchaseInvoices'").get();
  const cashMeta=db.prepare("SELECT * FROM pf_query_projection_meta WHERE entity='cashEntries'").get();
  const receivables=num(salesMeta?.sum_receivable);
  const payables=num(purchaseMeta?.sum_remaining)-num(purchaseMeta?.sum_overpayment);
  const overdueAggregate=db.prepare("SELECT COALESCE(SUM(invoice_count),0) overdueCount,COALESCE(SUM(remaining_total),0) overdueTotal FROM pf_due_daily WHERE due_date<?").get(today);
  const account={count:num(salesMeta?.outstanding_count),total:num(salesMeta?.outstanding_remaining),...overdueAggregate};
  const overdue = db.prepare(`SELECT * FROM pf_query_records WHERE ${salesWhere} AND remaining>0 AND due_date<>'' AND due_date<@today ORDER BY due_date,id LIMIT 8`).all({today}).map((row)=>summaryToObject(row,"salesInvoices"));
  mark("financial");
  const chartData = [];
  const chartStartDate=new Date(now);chartStartDate.setDate(chartStartDate.getDate()-13);const chartStart=localDate(chartStartDate);
  const chartRows=[...db.prepare("SELECT entity,date,total FROM pf_dashboard_daily WHERE entity='salesInvoices' AND date>=?").all(chartStart),...db.prepare("SELECT entity,date,total FROM pf_dashboard_daily WHERE entity='salesReturns' AND date>=?").all(chartStart),...db.prepare("SELECT entity,date,total FROM pf_dashboard_daily WHERE entity='purchaseInvoices' AND date>=?").all(chartStart)];
  const chartMap=new Map(chartRows.map((row)=>[`${row.entity}:${row.date}`,num(row.total)]));
  for (let offset=13; offset>=0; offset-=1) {
    const day = new Date(now); day.setDate(day.getDate()-offset); const iso=localDate(day);
    chartData.push({ date: iso.slice(5), sales: permissions.sales ? num(chartMap.get(`salesInvoices:${iso}`))-num(chartMap.get(`salesReturns:${iso}`)) : 0, purchases: permissions.purchases ? num(chartMap.get(`purchaseInvoices:${iso}`)) : 0 });
  }
  const recentRows = [...db.prepare("SELECT * FROM pf_query_records WHERE entity='salesInvoices' AND cancelled=0 ORDER BY date DESC,id DESC LIMIT 12").all(),...db.prepare("SELECT * FROM pf_query_records WHERE entity='purchaseInvoices' AND cancelled=0 ORDER BY date DESC,id DESC LIMIT 12").all()].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,12);
  const recentActivity = recentRows.filter((row)=>row.entity === "salesInvoices" ? permissions.sales : permissions.purchases).slice(0,8).map((row)=>({ id:row.id,title:`${row.entity === "salesInvoices" ? "\u0628\u064a\u0639 \u0642\u0637\u0639" : "\u062a\u0648\u0631\u064a\u062f \u0642\u0637\u0639"} \u00b7 ${row.number}`,sub:row.party_name,amount:row.total,date:row.date,tone:row.entity === "salesInvoices" ? "green" : "blue",to:`/${row.entity === "salesInvoices" ? "sales" : "purchases"}/${row.id}`}));
  mark("chartsRecent");
  const topSellingProducts = db.prepare(`SELECT product_name name,SUM(CASE WHEN entity='salesReturns' THEN -revenue ELSE revenue END) revenue
    FROM pf_dashboard_product_daily WHERE date>=@cutoff GROUP BY product_id HAVING revenue>0 ORDER BY revenue DESC LIMIT 5`).all({cutoff});
  mark("topSelling");
  // Product cost is not copied into the narrow record table; calculate dead
  // stock from canonical product chunks in a bounded streaming pass.
  let deadStockValue=0; const topProductsByStock=[]; const sold=new Set(db.prepare("SELECT DISTINCT product_id FROM pf_dashboard_product_daily WHERE entity='salesInvoices' AND date>=?").all(cutoff).map((r)=>r.product_id));
  const productSource=canonicalState(db,"products"); const visit=(rows)=>{ for(const p of rows){ if(p.archived||num(p.quantity)<=0||sold.has(p.id)) continue; const value=num(p.quantity)*num(p.avgCost??p.purchasePrice); deadStockValue+=value; topProductsByStock.push({name:p.name,qty:value}); } };
  if(Array.isArray(productSource.plain)) visit(productSource.plain); else { const get=db.prepare("SELECT value FROM kv_store WHERE key=?"); for(let i=0;i<productSource.chunks;i++) visit(JSON.parse(get.get(`${STORE_PREFIX}products#${String(i).padStart(4,"0")}`).value)); }
  topProductsByStock.sort((a,b)=>b.qty-a.qty); topProductsByStock.splice(5);
  mark("deadStock");
  const settingsRaw=db.prepare("SELECT value FROM kv_store WHERE key=?").get(`${STORE_PREFIX}settings`)?.value; let settings={}; try{settings=JSON.parse(settingsRaw||"{}");}catch{}
  const cashBalance=num(settings.openingBalance)+num(cashMeta?.sum_paid);
  const result={ stats:{todaySales:permissions.sales?todaySales:0,monthlySales:permissions.sales?monthlySales:0,grossProfitMonth:permissions.sales?grossSales-discounts-grossReturns:0,deadStockValue,receivables:permissions.customers?receivables:0,payables:permissions.suppliers?payables:0,cashBalance:permissions.cash?cashBalance:0},accounts:{total:num(account.total),count:account.count,overdueCount:num(account.overdueCount),overdueTotal:num(account.overdueTotal),overdue},chartData,topProductsByStock,topSellingProducts,recentActivity,...(permissions.__profile?{_profile:profile}:{})};
  db.prepare("INSERT INTO pf_dashboard_cache(cache_key,projection_token,result_json,completed_at) VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET projection_token=excluded.projection_token,result_json=excluded.result_json,completed_at=excluded.completed_at")
    .run(cacheKey,projectionToken,JSON.stringify(result),new Date().toISOString());
  return result;
}

function statement(db, kind, partyId, input={}) {
  const entity=kind === "customer" ? "salesInvoices" : "purchaseInvoices";
  ensureEntity(db,entity);
  const pageResult=queryPage(db,entity,{...input,partyId});
  const balance=db.prepare("SELECT balance FROM pf_party_balances WHERE entity=? AND party_id=?").get(entity,text(partyId))?.balance;
  return {...pageResult,balance:num(balance)};
}

function duesParties(db,input={}){
  const {page,pageSize}=clampPage(input);const kind=input.kind==="all"?"all":input.kind==="supplier"?"supplier":"customer";
  const entities=kind==="all"?["salesInvoices","purchaseInvoices"]:[kind==="customer"?"salesInvoices":"purchaseInvoices"];
  for(const entity of entities)ensureEntity(db,entity);
  if(kind!=="supplier")ensureEntity(db,"customers");if(kind!=="customer")ensureEntity(db,"suppliers");
  const q=text(input.q).trim();const params={limit:pageSize,offset:page*pageSize};
  const where=[kind==="all"?"b.entity IN ('salesInvoices','purchaseInvoices')":"b.entity=@entity"];
  if(kind!=="all")params.entity=entities[0];
  if(q){where.push("(b.party_name LIKE @q OR c.code LIKE @q OR c.phone LIKE @q)");params.q=`%${q.replace(/[\\%_]/g,"\\$&")}%`;}
  if(input.direction==="theyOweUs")where.push("((b.entity='salesInvoices' AND b.balance>0) OR (b.entity='purchaseInvoices' AND b.balance<0))");
  else if(input.direction==="weOweThem")where.push("((b.entity='salesInvoices' AND b.balance<0) OR (b.entity='purchaseInvoices' AND b.balance>0))");
  else if(input.direction==="positive")where.push("b.balance>0");else if(input.direction==="negative")where.push("b.balance<0");
  const sqlWhere=where.join(" AND ");
  const join="LEFT JOIN pf_catalog_search c ON c.entity=CASE b.entity WHEN 'salesInvoices' THEN 'customers' ELSE 'suppliers' END AND c.id=b.party_id";
  const total=db.prepare(`SELECT COUNT(*) count FROM pf_party_balances b ${join} WHERE ${sqlWhere}`).get(params).count;
  const rows=db.prepare(`SELECT b.*,c.code,c.phone FROM pf_party_balances b ${join} WHERE ${sqlWhere} ORDER BY ABS(b.balance) DESC,b.entity,b.party_id LIMIT @limit OFFSET @offset`).all(params);
  const due=db.prepare("SELECT COALESCE(SUM(CASE WHEN due_date<? THEN 1 ELSE 0 END),0) overdueCount,COALESCE(SUM(CASE WHEN due_date>=? AND due_date<=? THEN 1 ELSE 0 END),0) dueSoonCount FROM pf_query_records WHERE entity=? AND party_id=? AND cancelled=0 AND remaining>0 AND due_date<>''");
  const today=new Date().toISOString().slice(0,10);const soon=new Date();soon.setDate(soon.getDate()+7);const soonIso=soon.toISOString().slice(0,10);
  return {page,pageSize,total,rows:rows.map((row)=>{const rowKind=row.entity==="salesInvoices"?"customer":"supplier";const counts=rowKind==="customer"?due.get(today,today,soonIso,row.entity,row.party_id):{overdueCount:0,dueSoonCount:0};return{id:row.party_id,type:rowKind,name:row.party_name,code:row.code||undefined,phone:row.phone||undefined,balance:num(row.balance),direction:rowKind==="customer"?(row.balance>=0?"theyOweUs":"weOweThem"):(row.balance>0?"weOweThem":"theyOweUs"),openInvoices:row.open_invoices,overdueInvoices:num(counts.overdueCount),dueSoonInvoices:num(counts.dueSoonCount),lastActivity:row.last_activity||undefined};})};
}

function explain(db, sql, params={}) { return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params); }

module.exports = { VERSION, ENTITY_CONFIG, PROJECTION_ENTITIES, createControlSchema, createSchema, canonicalState, projectionSourceSnapshot, sourceSignature, inspectUpgrade, adoptCurrentProjection, writeUpgradeState, validateProjection, runUpgrade, refreshCompletionMarker, rebuildEntity, ensureEntity, invalidateChangedEntities, captureChangedEntities, syncChangedEntities, queryPage, recordDetail, catalogSearch, catalogDetail, search, dashboard, statement, duesParties, explain };
