// Real production handlers on disposable local PostgreSQL. Never run on live data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {createHash,randomUUID} = require("node:crypto");
const {Client} = require("pg");
const {drizzle} = require("drizzle-orm/node-postgres");
const posRoot=path.resolve(__dirname,"../../lovely-kids-pos");
const vitePath=require.resolve("vite",{paths:[posRoot]});
const {build}=require(require.resolve("esbuild",{paths:[path.dirname(vitePath)]}));
const buildDir=path.join(__dirname,".tmp-credit-void-acceptance");
const cfg={host:process.env.PGHOST||"127.0.0.1",port:Number(process.env.PGPORT||5432),
  user:process.env.PGUSER||"tester",password:process.env.PGPASSWORD||"testonly",
  database:process.env.PGDATABASE||"customer_voucher_test"};
if(process.env.CUSTOMER_VOUCHER_DISPOSABLE_DB!=="1" ||
   !["127.0.0.1","localhost"].includes(cfg.host) ||
   cfg.database!=="customer_voucher_test")
  throw new Error("Refusing to run against non-disposable database");
function req(p,token,body){
  return new Request("http://127.0.0.1"+p,{method:"POST",
   headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
   body:JSON.stringify(body)});
}
async function handlers(){
 await build({entryPoints:[path.join(__dirname,"finance-voucher-routes.ts"),
                           path.join(__dirname,"party-finance-routes.ts")],
   outdir:buildDir,outExtension:{".js":".mjs"},
   bundle:true,platform:"node",target:"node22",format:"esm",
   external:["bcryptjs","pg","web-push","drizzle-orm","drizzle-orm/*",
             "drizzle-zod","zod","zod/*","@clerk/backend"],logLevel:"warning"});
 const p=await import(pathToFileURL(path.join(buildDir,"finance-voucher-routes.mjs")).href);
 const v=await import(pathToFileURL(path.join(buildDir,"party-finance-routes.mjs")).href);
 return {pay:p.handleUnifiedVoucherRequest,void:v.handlePartyFinanceRequest};
}
async function seedSchema(pg){
 await pg.query([
 "CREATE TABLE users(id serial PRIMARY KEY,phone text,email text,name text NOT NULL,password_hash text,clerk_user_id text,avatar_url text,delivery_address text,is_admin boolean NOT NULL DEFAULT false,is_owner boolean NOT NULL DEFAULT false,created_at timestamp NOT NULL DEFAULT now());",
 "CREATE TABLE sessions(token text PRIMARY KEY,user_id integer NOT NULL,created_at timestamp NOT NULL DEFAULT now());",
 "CREATE TABLE finance_currencies(code text PRIMARY KEY,name_ar text,name_en text,symbol text,minor_unit integer DEFAULT 2,is_base boolean DEFAULT false,status text DEFAULT 'active',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());",
 "CREATE TABLE customers(id serial PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,phone text,address text,notes text,credit_limit_minor integer,status text NOT NULL DEFAULT 'active',created_by_user_id integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
 "CREATE TABLE cash_sessions(id serial PRIMARY KEY,register_key text NOT NULL,business_date date NOT NULL,opened_by_user_id integer NOT NULL,closed_by_user_id integer,opening_balance_minor integer NOT NULL,closing_balance_minor integer,expected_balance_minor integer,currency_code text NOT NULL DEFAULT 'ILS',status text NOT NULL DEFAULT 'open',opening_note text,closing_note text,opened_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
 "CREATE TABLE finance_accounts(id serial PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,account_type text NOT NULL,linked_entity_type text,linked_entity_id integer,currency_code text NOT NULL DEFAULT 'ILS',status text NOT NULL DEFAULT 'active',notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
 "CREATE TABLE finance_transactions(id serial PRIMARY KEY,public_id text NOT NULL UNIQUE,idempotency_key text NOT NULL UNIQUE,business_date date NOT NULL,transaction_type text NOT NULL,source_type text NOT NULL,source_id text NOT NULL,source_event text NOT NULL,cash_session_id integer,status text NOT NULL DEFAULT 'posted',notes text,created_by_user_id integer,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
 "CREATE UNIQUE INDEX finance_active_source ON finance_transactions(source_type,source_id,source_event) WHERE status='posted';",
 "CREATE TABLE finance_transaction_lines(id serial PRIMARY KEY,transaction_id integer NOT NULL,line_number integer NOT NULL,account_id integer NOT NULL,customer_id integer,employee_id integer,supplier_id integer,currency_code text,currency_amount_minor integer,exchange_rate_micros integer,debit_minor integer NOT NULL DEFAULT 0,credit_minor integer NOT NULL DEFAULT 0,memo text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(transaction_id,line_number));",
 "CREATE TABLE finance_vouchers(id serial PRIMARY KEY,public_id text NOT NULL UNIQUE,idempotency_key text NOT NULL UNIQUE,voucher_type text NOT NULL,voucher_purpose text,party_type text,party_id integer,expense_category_id integer,payment_method text NOT NULL,amount_minor integer NOT NULL,currency_code text NOT NULL DEFAULT 'ILS',transaction_amount_minor integer,exchange_rate_micros integer NOT NULL DEFAULT 1000000,bank_account_id integer,business_date date NOT NULL,reference_period text,cash_session_id integer,finance_transaction_id integer,replaces_voucher_id integer,status text NOT NULL DEFAULT 'posted',notes text,created_by_user_id integer NOT NULL,voided_at timestamptz,voided_by_user_id integer,void_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
 ].join("\n"));
}
async function scalar(pg,q,args=[]){const r=await pg.query(q,args);return Object.values(r.rows[0])[0];}
async function customerBalance(pg,id){return scalar(pg,
  "SELECT COALESCE(SUM(debit_minor-credit_minor),0)::int AS n FROM finance_transaction_lines WHERE customer_id=$1",[id]);}
async function cashBalance(pg){return scalar(pg,
 "SELECT expected_balance_minor FROM cash_sessions WHERE register_key='main' AND status='open'");}
test("65 shekel payout -> zero credit -> void -> original credit and cash fully restored",
  {timeout:180000},async()=>{
 const pg=new Client(cfg);await pg.connect();
 try {
  await seedSchema(pg);
  const h=await handlers(),db=drizzle(pg),env={};
  assert.equal(typeof h.pay,"function");assert.equal(typeof h.void,"function");
  const owner=await scalar(pg,
    "INSERT INTO users(name,is_owner) VALUES('Disposable test owner',true) RETURNING id");
  const customer=await scalar(pg,
    "INSERT INTO customers(code,name,created_by_user_id) VALUES('TEST65','Disposable only',$1) RETURNING id",[owner]);
  const token="test-token-"+randomUUID();
  await pg.query("INSERT INTO sessions(token,user_id) VALUES($1,$2)",
    ["sha256:"+createHash("sha256").update(token).digest("hex"),owner]);
  await pg.query("INSERT INTO finance_currencies(code,name_ar,name_en,symbol,is_base) VALUES('ILS','شيكل','Shekel','₪',true)");
  const acc=(await pg.query("INSERT INTO finance_accounts(code,name,account_type) VALUES('CASH_MAIN','Test register','asset'),('CUSTOMER_RECEIVABLE_CONTROL','Test receivable','asset'),('TEST_CREDIT_OFFSET','Test offset','liability') RETURNING id,code")).rows;
  const a=Object.fromEntries(acc.map(x=>[x.code,x.id]));
  await pg.query("INSERT INTO cash_sessions(register_key,business_date,opened_by_user_id,opening_balance_minor,expected_balance_minor) VALUES('main',CURRENT_DATE,$1,100000,100000)",[owner]);
  const seedId=await scalar(pg,
    "INSERT INTO finance_transactions(public_id,idempotency_key,business_date,transaction_type,source_type,source_id,source_event,created_by_user_id) VALUES('FIN-OPENING-TEST65','test-customer-opening-credit',CURRENT_DATE,'adjustment','test_seed','1','initial',$1) RETURNING id",[owner]);
  await pg.query("INSERT INTO finance_transaction_lines(transaction_id,line_number,account_id,customer_id,debit_minor,credit_minor) VALUES($1,1,$2,$3,0,6500),($1,2,$4,NULL,6500,0)",
   [seedId,a.CUSTOMER_RECEIVABLE_CONTROL,customer,a.TEST_CREDIT_OFFSET]);
  assert.equal(await customerBalance(pg,customer),-6500);
  assert.equal(await cashBalance(pg),100000);
  const url="/api/pos/finance/vouchers/payment";
  const body={partyType:"customer",partyId:customer,amount:"65.00",paymentMethod:"cash",
    registerKey:"main",notes:"Isolated test; not actually paid",
    idempotencyKey:"test-credit-"+randomUUID()};
  const denied=await h.pay(req(url,token,{...body,amount:"65.01",
    idempotencyKey:"test-overpay-"+randomUUID()}),db,env);
  assert.equal(denied.status,409,await denied.clone().text());
  assert.equal(await customerBalance(pg,customer),-6500);
  assert.equal(await cashBalance(pg),100000);
  const paid=await h.pay(req(url,token,body),db,env);
  assert.equal(paid.status,201,await paid.clone().text());
  const {voucher,expectedCashBeforeMinor,expectedCashAfterMinor}=await paid.json();
  assert.match(voucher.publicId,/^PAY-/);
  assert.equal(voucher.voucherType,"payment");
  assert.equal(voucher.amountMinor,6500);
  assert.equal(expectedCashBeforeMinor,100000);
  assert.equal(expectedCashAfterMinor,93500);
  assert.equal(await customerBalance(pg,customer),0);
  assert.equal(await cashBalance(pg),93500);
  const oldCount=await scalar(pg,"SELECT count(*)::int FROM finance_vouchers");
  const retried=await h.pay(req(url,token,body),db,env);
  assert.equal(retried.status,200,await retried.clone().text());
  assert.equal((await retried.json()).alreadyCreated,true);
  assert.equal(await scalar(pg,"SELECT count(*)::int FROM finance_vouchers"),oldCount);
  const noCredit=await h.pay(req(url,token,{...body,amount:"1.00",
    idempotencyKey:"test-empty-credit-"+randomUUID()}),db,env);
  assert.equal(noCredit.status,409,await noCredit.clone().text());
  const voidUrl="/api/pos/finance/vouchers/"+voucher.id+"/void";
  const reversed=await h.void(req(voidUrl,token,{reason:"Isolated accounting test (no payout occurred)"}),db,env);
  assert.equal(reversed.status,200,await reversed.clone().text());
  assert.equal(await customerBalance(pg,customer),-6500);
  assert.equal(await cashBalance(pg),100000);
  const record=(await pg.query("SELECT status,void_reason,finance_transaction_id FROM finance_vouchers WHERE id=$1",[voucher.id])).rows[0];
  assert.equal(record.status,"voided");
  assert.match(record.void_reason,/Isolated/);
  assert.equal(await scalar(pg,"SELECT status FROM finance_transactions WHERE id=$1",[record.finance_transaction_id]),"reversed");
  const reverseRow=(await pg.query("SELECT id,transaction_type FROM finance_transactions WHERE source_type='finance_voucher' AND source_id=$1 AND source_event='voided'",[String(voucher.id)])).rows;
  assert.equal(reverseRow.length,1);
  assert.equal(reverseRow[0].transaction_type,"reversal");
  const lines=(await pg.query("SELECT account_id,SUM(debit_minor-credit_minor)::int AS net FROM finance_transaction_lines WHERE transaction_id=ANY($1::int[]) GROUP BY account_id",
   [[record.finance_transaction_id,reverseRow[0].id]])).rows;
  assert.equal(lines.length,2);
  assert.ok(lines.every(x=>x.net===0),JSON.stringify(lines));
  const duplicateVoid=await h.void(req(voidUrl,token,{reason:"Try cancelling twice"}),db,env);
  assert.equal(duplicateVoid.status,409,await duplicateVoid.clone().text());
  assert.equal(await customerBalance(pg,customer),-6500);
  assert.equal(await cashBalance(pg),100000);
 } finally { await pg.end();fs.rmSync(buildDir,{recursive:true,force:true}); }
});
