// Actual financial close -> exact reversal -> re-close against disposable PostgreSQL.
// NEVER run on production: hard-guard host and database name.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const {Client}=require("pg");
const {drizzle}=require("drizzle-orm/node-postgres");
const posRoot=path.resolve(__dirname,"../../lovely-kids-pos");
const vitePath=require.resolve("vite",{paths:[posRoot]});
const {build}=require(require.resolve("esbuild",{paths:[path.dirname(vitePath)]}));
const buildDir=path.join(__dirname,".tmp-import-close-integration");
const cfg={host:process.env.PGHOST||"127.0.0.1",port:Number(process.env.PGPORT||5432),
  user:process.env.PGUSER||"tester",password:process.env.PGPASSWORD||"testonly",
  database:process.env.PGDATABASE||"import_close_integration"};
if(process.env.IMPORT_CLOSE_DISPOSABLE_DB!=="1"||
   !["127.0.0.1","localhost"].includes(cfg.host)||
   cfg.database!=="import_close_integration")
  throw new Error("Refusing to touch a database that is not the designated disposable import-close fixture");

async function compile(){
  await build({entryPoints:[path.join(__dirname,"import-accounting-close.ts")],
    outdir:buildDir,outExtension:{".js":".mjs"},bundle:true,
    platform:"node",target:"node22",format:"esm",
    external:["pg","drizzle-orm","drizzle-orm/*","bcryptjs","@clerk/backend"],
    logLevel:"warning"});
  return import(pathToFileURL(path.join(buildDir,"import-accounting-close.mjs")).href);
}
async function schema(pg){
  await pg.query([
    "CREATE TABLE users(id integer PRIMARY KEY);",
    "INSERT INTO users(id) VALUES(1);",
    "CREATE TABLE suppliers(id integer PRIMARY KEY);",
    "INSERT INTO suppliers(id) VALUES(11);",
    "CREATE TABLE bank_accounts(id integer PRIMARY KEY,finance_account_id integer,currency_code text,status text);",
    "CREATE TABLE cash_sessions(id integer PRIMARY KEY);",
    "CREATE TABLE pos_purchases(id integer PRIMARY KEY);",
    "CREATE TABLE finance_vouchers(id integer PRIMARY KEY);",
    "CREATE TABLE finance_accounts(id serial PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,account_type text NOT NULL,linked_entity_type text,linked_entity_id integer,currency_code text NOT NULL DEFAULT 'ILS',status text NOT NULL DEFAULT 'active',notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
    "CREATE TABLE finance_transactions(id serial PRIMARY KEY,public_id text NOT NULL UNIQUE,idempotency_key text NOT NULL UNIQUE,business_date date NOT NULL,transaction_type text NOT NULL,source_type text NOT NULL,source_id text NOT NULL,source_event text NOT NULL,cash_session_id integer,status text NOT NULL DEFAULT 'posted',notes text,created_by_user_id integer,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
    "CREATE UNIQUE INDEX finance_active_source ON finance_transactions(source_type,source_id,source_event) WHERE status='posted';",
    "CREATE TABLE finance_transaction_lines(id serial PRIMARY KEY,transaction_id integer NOT NULL,line_number integer NOT NULL,account_id integer NOT NULL,customer_id integer,employee_id integer,supplier_id integer,currency_code text,currency_amount_minor integer,exchange_rate_micros integer,debit_minor integer NOT NULL DEFAULT 0,credit_minor integer NOT NULL DEFAULT 0,memo text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(transaction_id,line_number));",
  ].join("\n"));
  for(const migration of [
    "20261109_create_import_cost_drafts.sql",
    "20261109_import_purchase_evidence_links.sql",
    "20261109_import_supplier_voucher_claims.sql",
    "20261109_import_accounting_closures.sql",
  ]){
    await pg.query(fs.readFileSync(path.resolve(__dirname,"../../../lib/db/migrations",migration),"utf8"));
  }
}
async function seed(pg){
  const codes=[
    ["PURCHASE_INVENTORY","asset"],
    ["SUPPLIER_PAYABLE_CONTROL","liability"],
    ["IMPORT_SUPPLIER_ADVANCES","asset"],
    ["IMPORT_SHIPMENT_COST_CLEARING","asset"],
    ["CASH_MAIN","asset"],
    ["BANK_TEST","asset"],
  ];
  for(const [code,type] of codes){
    await pg.query("INSERT INTO finance_accounts(code,name,account_type) VALUES($1,$1,$2)",[code,type]);
  }
  const rows=(await pg.query("SELECT id,code FROM finance_accounts")).rows;
  const ids=Object.fromEntries(rows.map(r=>[r.code,r.id]));
  const id=(await pg.query(
    "INSERT INTO import_cost_cases(public_id,idempotency_key,business_date,title,created_by_user_id) VALUES('IMP-TEST-CLOSE','test-closure-case-001','2026-11-09','Disposable supplier import',1) RETURNING id")).rows[0].id;
  const journal=(await pg.query(
    "INSERT INTO finance_transactions(public_id,idempotency_key,business_date,transaction_type,source_type,source_id,source_event,created_by_user_id) VALUES('FIN-OPEN-IMPORT-TEST','test-initial-import-balances-1','2026-11-09','adjustment','test_opening','1','initial',1) RETURNING id")).rows[0].id;
  const tuples=[
    [ids.PURCHASE_INVENTORY,null,37000,0],
    [ids.SUPPLIER_PAYABLE_CONTROL,11,0,37000],
    [ids.IMPORT_SUPPLIER_ADVANCES,11,35000,0],
    [ids.BANK_TEST,null,0,35000],
    [ids.IMPORT_SHIPMENT_COST_CLEARING,null,2000,0],
    [ids.CASH_MAIN,null,0,2000],
  ];
  for(const [i,[accountId,supplierId,debit,credit]] of tuples.entries()){
    await pg.query("INSERT INTO finance_transaction_lines(transaction_id,line_number,account_id,supplier_id,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5,$6)",
      [journal,i+1,accountId,supplierId,debit,credit]);
  }
  return{id,ids};
}
const eligiblePlan={
  ready:true,balanced:true,debitMinor:37000,creditMinor:37000,
  blockers:[],canExecute:false,journalPosted:false,
  journalLines:[
    {accountCode:"SUPPLIER_PAYABLE_CONTROL",supplierId:11,debitMinor:35000,creditMinor:0,memo:"تسوية دفعة دولار مقدمة"},
    {accountCode:"IMPORT_SUPPLIER_ADVANCES",supplierId:11,debitMinor:0,creditMinor:35000,memo:"تصفية أصل مقدمات الدولار"},
    {accountCode:"SUPPLIER_PAYABLE_CONTROL",supplierId:11,debitMinor:2000,creditMinor:0,memo:"تسوية مصاريف النقل والشحن"},
    {accountCode:"IMPORT_SHIPMENT_COST_CLEARING",supplierId:null,debitMinor:0,creditMinor:2000,memo:"تصفية حساب تجميع الشحن"},
  ],
};
const closeHash="a".repeat(64);
let readRevision=1;
const read=async(tx,caseId,env)=>({
  case:{id:caseId,status:"draft",revision:readRevision},
  draft:{withTravel:false},
  closePlanHash:closeHash,
  closePreview:{reasons:["قيد تسوية مقدمات المورد والشحن والسفر غير مربوط أو غير مرحل"]},
  clearingPreview:eligiblePlan,
});
async function balance(pg,code,supplierId){
  const r=await pg.query(
    `SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0)::int AS net
       FROM finance_transaction_lines l JOIN finance_accounts a ON a.id=l.account_id
      WHERE a.code=$1 AND ($2::int IS NULL OR l.supplier_id=$2)`,
    [code,supplierId??null]);
  return r.rows[0].net;
}
const date="2026-11-09";
test("actual posted import closing, idempotency, exact reversal and safe re-close",{
  timeout:180000,
},async()=>{
 const pg=new Client(cfg);await pg.connect();
 try{
   await schema(pg);
   const {id}=await seed(pg);
   const h=await compile();
   const db=drizzle(pg);
   const closeInput={
     caseId:id,expectedRevision:1,expectedPlanHash:closeHash,
     businessDate:date,idempotencyKey:"test-close-idempotency-1",
     travelClassificationConfirmed:false,
   };
   await assert.rejects(h.postImportAccountingClose(db,{},1,closeInput,read),
     /غير مفعل/);
   assert.equal(await balance(pg,"PURCHASE_INVENTORY",null),37000);
   const posted=await h.postImportAccountingClose(db,
     {POS_IMPORT_CLOSING_ENABLED:"true"},1,closeInput,read);
   assert.equal(posted.alreadyPosted,false);
   assert.ok(posted.financeTransactionId);
   assert.equal(await balance(pg,"SUPPLIER_PAYABLE_CONTROL",11),0);
   assert.equal(await balance(pg,"IMPORT_SUPPLIER_ADVANCES",null),0);
   assert.equal(await balance(pg,"IMPORT_SHIPMENT_COST_CLEARING",null),0);
   assert.equal(await balance(pg,"PURCHASE_INVENTORY",null),37000);
   assert.equal(await balance(pg,"BANK_TEST",null),-35000);
   assert.equal(await balance(pg,"CASH_MAIN",null),-2000);
   assert.equal((await pg.query("SELECT status FROM import_cost_cases WHERE id=$1",[id])).rows[0].status,"closed");
   const replay=await h.postImportAccountingClose(db,
     {POS_IMPORT_CLOSING_ENABLED:"true"},1,closeInput,read);
   assert.equal(replay.alreadyPosted,true);
   await assert.rejects(h.postImportAccountingClose(db,{POS_IMPORT_CLOSING_ENABLED:"true"},1,
     {...closeInput,businessDate:"2026-11-10"},read),/مفتاح الإقفال/);
   const reverseInput={caseId:id,expectedRevision:2,businessDate:date,
     idempotencyKey:"test-close-reversal-key-1",reason:"Integration test reversal restores same supplier balances"};
   const reversed=await h.reverseImportAccountingClose(db,
     {POS_IMPORT_CLOSING_ENABLED:"true"},1,reverseInput);
   assert.equal(reversed.alreadyReversed,false);
   assert.ok(reversed.financeTransactionId);
   assert.equal(await balance(pg,"SUPPLIER_PAYABLE_CONTROL",11),-37000);
   assert.equal(await balance(pg,"IMPORT_SUPPLIER_ADVANCES",null),35000);
   assert.equal(await balance(pg,"IMPORT_SHIPMENT_COST_CLEARING",null),2000);
   assert.equal(await balance(pg,"PURCHASE_INVENTORY",null),37000);
   assert.equal(await balance(pg,"BANK_TEST",null),-35000);
   assert.equal(await balance(pg,"CASH_MAIN",null),-2000);
   const status=(await pg.query("SELECT status FROM finance_transactions WHERE id=$1",
     [posted.financeTransactionId])).rows[0].status;
   assert.equal(status,"reversed");
   const replayReverse=await h.reverseImportAccountingClose(db,
     {POS_IMPORT_CLOSING_ENABLED:"true"},1,reverseInput);
   assert.equal(replayReverse.alreadyReversed,true);
   await assert.rejects(h.reverseImportAccountingClose(db,
     {POS_IMPORT_CLOSING_ENABLED:"true"},1,
     {...reverseInput,reason:"Different reason for same key"}),/مفتاح العكس/);
   readRevision=3;
   const reclosed=await h.postImportAccountingClose(db,
     {POS_IMPORT_CLOSING_ENABLED:"true"},1,{
       ...closeInput,expectedRevision:3,idempotencyKey:"test-close-idempotency-2",
     },read);
   assert.equal(reclosed.alreadyPosted,false);
   assert.notEqual(reclosed.closureId,posted.closureId);
   assert.equal(await balance(pg,"SUPPLIER_PAYABLE_CONTROL",11),0);
   assert.equal(await balance(pg,"PURCHASE_INVENTORY",null),37000);
   assert.equal((await pg.query("SELECT count(*)::int AS n FROM import_cost_closures")).rows[0].n,2);
 }finally{
   await pg.end();
   fs.rmSync(buildDir,{recursive:true,force:true});
 }
});
