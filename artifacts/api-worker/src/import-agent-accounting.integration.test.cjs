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
const buildDir=path.join(__dirname,".tmp-import-agent-acceptance");
const cfg={host:process.env.PGHOST||"127.0.0.1",port:Number(process.env.PGPORT||5432),
  user:process.env.PGUSER||"tester",password:process.env.PGPASSWORD||"testonly",
  database:process.env.PGDATABASE||"import_agent_test"};
if(process.env.IMPORT_AGENT_DISPOSABLE_DB!=="1" ||
   !["127.0.0.1","localhost"].includes(cfg.host) ||
   cfg.database!=="import_agent_test")
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
 "CREATE TABLE suppliers(id serial PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,contact_person text,phone text,mobile text,email text,address text,notes text,status text NOT NULL DEFAULT 'active',created_by_user_id integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
 "CREATE TABLE cash_sessions(id serial PRIMARY KEY,register_key text NOT NULL,business_date date NOT NULL,opened_by_user_id integer NOT NULL,closed_by_user_id integer,opening_balance_minor integer NOT NULL,closing_balance_minor integer,expected_balance_minor integer,currency_code text NOT NULL DEFAULT 'ILS',status text NOT NULL DEFAULT 'open',opening_note text,closing_note text,opened_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
 "CREATE TABLE finance_accounts(id serial PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,account_type text NOT NULL,linked_entity_type text,linked_entity_id integer,currency_code text NOT NULL DEFAULT 'ILS',status text NOT NULL DEFAULT 'active',notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
 "CREATE TABLE banks(id serial PRIMARY KEY,code text NOT NULL,name_ar text NOT NULL,name_en text,status text NOT NULL DEFAULT 'active',notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
 "CREATE TABLE bank_accounts(id serial PRIMARY KEY,bank_id integer NOT NULL,code text NOT NULL,name text NOT NULL,account_number text,iban text,currency_code text NOT NULL DEFAULT 'ILS',finance_account_id integer NOT NULL,status text NOT NULL DEFAULT 'active',notes text,created_by_user_id integer,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());",
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

test("real ILS bank to shipping agent to supplier and freight, with net zero and no duplicate inventory",
  {timeout:180000},async()=>{
 const pg=new Client(cfg);await pg.connect();
 try {
  await seedSchema(pg);
  const h=await handlers(),db=drizzle(pg),env={};
  assert.equal(typeof h.pay,"function");
  const owner=await scalar(pg,
    "INSERT INTO users(name,is_owner) VALUES('Disposable import test owner',true) RETURNING id");
  const supplier=await scalar(pg,
    "INSERT INTO suppliers(code,name,created_by_user_id) VALUES('IMPORT-TEST','Disposable supplier',$1) RETURNING id",[owner]);
  const token="test-agent-"+randomUUID();
  await pg.query("INSERT INTO sessions(token,user_id) VALUES($1,$2)",
    ["sha256:"+createHash("sha256").update(token).digest("hex"),owner]);
  await pg.query("INSERT INTO finance_currencies(code,name_ar,name_en,symbol,is_base) VALUES('ILS','شيكل','Shekel','₪',true)");
  const accountRows=(await pg.query(
    "INSERT INTO finance_accounts(code,name,account_type) VALUES"+
    "('BANK_TEST','Real disposable bank','asset'),"+
    "('IMPORT_AGENT_CLEARING','Agent asset','asset'),"+
    "('IMPORT_FREIGHT_IN_TRANSIT','Freight advance asset','asset'),"+
    "('SUPPLIER_PAYABLE_CONTROL','Supplier payable','liability'),"+
    "('PURCHASE_INVENTORY','Inventory already recognized','asset'),"+
    "('TEST_OPENING_EQUITY','Opening capital','equity') RETURNING id,code"
  )).rows;
  const a=Object.fromEntries(accountRows.map(x=>[x.code,x.id]));
  const bankId=await scalar(pg,"INSERT INTO banks(code,name_ar) VALUES('TEST_BANK','Disposable bank') RETURNING id");
  const ba=await scalar(pg,
    "INSERT INTO bank_accounts(bank_id,code,name,currency_code,finance_account_id,created_by_user_id) VALUES($1,'TEST_ILS','Test account','ILS',$2,$3) RETURNING id",[bankId,a.BANK_TEST,owner]);
  const seed=await scalar(pg,
    "INSERT INTO finance_transactions(public_id,idempotency_key,business_date,transaction_type,source_type,source_id,source_event,created_by_user_id) "+
    "VALUES('FIN-IMPORT-SEED','test-import-seed',CURRENT_DATE,'adjustment','test_seed','1','initial',$1) RETURNING id",[owner]);
  // Opening bank balance 6000.00 ILS; purchase invoice was already posted
  // once at 5352.73 ILS including freight. Supplier payable includes freight.
  await pg.query("INSERT INTO finance_transaction_lines(transaction_id,line_number,account_id,supplier_id,debit_minor,credit_minor) VALUES"+
    "($1,1,$2,NULL,600000,0),($1,2,$3,NULL,0,600000),"+
    "($1,3,$4,NULL,535273,0),($1,4,$5,$6,0,535273)",
    [seed,a.BANK_TEST,a.TEST_OPENING_EQUITY,a.PURCHASE_INVENTORY,a.SUPPLIER_PAYABLE_CONTROL,supplier]);

  const balance=async accountId=>Number(await scalar(pg,
    "SELECT COALESCE(SUM(debit_minor-credit_minor),0)::int FROM finance_transaction_lines WHERE account_id=$1",[accountId]));
  const call=async(from,to,amount,note,idem)=>{
    const response=await h.pay(req("/api/pos/finance/vouchers/journal",token,
      {from,to,amount,notes:note,idempotencyKey:idem}),db,env);
    const data=await response.clone().text();
    return {status:response.status,body:data};
  };
  const bank={kind:"bank",bankAccountId:ba};
  const agent={kind:"finance_account",financeAccountId:a.IMPORT_AGENT_CLEARING};
  const freight={kind:"finance_account",financeAccountId:a.IMPORT_FREIGHT_IN_TRANSIT};
  const vendor={kind:"supplier",supplierId:supplier};

  const fundingKey="agent-test-fund-"+randomUUID();
  const fund=await call(bank,agent,"5352.73","شحنة تجريبية: عهدة شركة الشحن 1565 USD بالدولار للمرجع فقط",fundingKey);
  assert.equal(fund.status,201,fund.body);
  const repeat=await call(bank,agent,"5352.73","شحنة تجريبية: عهدة شركة الشحن 1565 USD بالدولار للمرجع فقط",fundingKey);
  assert.equal(repeat.status,200,repeat.body);
  assert.equal(await balance(a.BANK_TEST),64727);
  assert.equal(await balance(a.IMPORT_AGENT_CLEARING),535273);

  const vendorPayment=await call(agent,vendor,"4992.73","شحنة تجريبية: سداد فاتورة المورد 1565 USD بقيمة 4992.73 ILS","agent-test-pay-"+randomUUID());
  assert.equal(vendorPayment.status,201,vendorPayment.body);
  assert.equal(await balance(a.IMPORT_AGENT_CLEARING),36000);
  assert.equal(await balance(a.SUPPLIER_PAYABLE_CONTROL),-36000);

  const fee=await call(agent,freight,"360.00","شحنة تجريبية: تخليص 330 شيكل ونقل 30 شيكل","agent-test-fee-"+randomUUID());
  assert.equal(fee.status,201,fee.body);
  assert.equal(await balance(a.IMPORT_AGENT_CLEARING),0);
  assert.equal(await balance(a.IMPORT_FREIGHT_IN_TRANSIT),36000);

  const blocked=await call(agent,vendor,"1.00","ممنوع سحب من عهدة صفر","agent-test-overdraw-"+randomUUID());
  assert.equal(blocked.status,409,blocked.body);
  const illegal=await call(freight,bank,"100.00","لا يجوز تحويل الشحن للبنك مباشرة","agent-test-illegal-"+randomUUID());
  assert.equal(illegal.status,409,illegal.body);

  const reconcile=await call(freight,vendor,"360.00","تسوية شحن فاتورة مشتريات معتمدة أدخلت تكلفته ضمن المخزون","agent-test-reconcile-"+randomUUID());
  assert.equal(reconcile.status,201,reconcile.body);
  assert.equal(await balance(a.IMPORT_AGENT_CLEARING),0);
  assert.equal(await balance(a.IMPORT_FREIGHT_IN_TRANSIT),0);
  assert.equal(await balance(a.SUPPLIER_PAYABLE_CONTROL),0);
  assert.equal(await balance(a.PURCHASE_INVENTORY),535273);
  assert.equal(await balance(a.BANK_TEST),64727);
  assert.equal(Number(await scalar(pg,"SELECT COALESCE(SUM(debit_minor-credit_minor),0)::int FROM finance_transaction_lines")),0);
  assert.equal(Number(await scalar(pg,"SELECT count(*)::int FROM finance_vouchers")),4);
  assert.equal(Number(await scalar(pg,"SELECT count(*)::int FROM finance_transaction_lines WHERE account_id=$1 AND transaction_id!=$2",[a.PURCHASE_INVENTORY,seed])),0);
 } finally { await pg.end();fs.rmSync(buildDir,{recursive:true,force:true}); }
});
