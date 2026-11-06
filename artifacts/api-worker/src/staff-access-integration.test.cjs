// Real auth and staff handlers against disposable PostgreSQL only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {randomUUID, createHash} = require("node:crypto");
const bcrypt = require("bcryptjs");
const {Client} = require("pg");
const {drizzle} = require("drizzle-orm/node-postgres");

const root = path.resolve(__dirname, "../../..");
const posRoot = path.resolve(__dirname, "../../lovely-kids-pos");
const vitePath = require.resolve("vite", {paths:[posRoot]});
const esbuildPath = require.resolve("esbuild", {paths:[path.dirname(vitePath)]});
const {build} = require(esbuildPath);
const buildDir = path.join(__dirname, ".tmp-staff-acceptance");
const OWNER_PWD = "TEST-Owner-Only-Do-Not-Reuse-2026!";
const STAFF_PWD = "TEST-Cashier-Only-Do-Not-Reuse-2026!";

if (process.env.STAFF_PERMISSIONS_DISPOSABLE_DB !== "1" ||
    !["localhost","127.0.0.1"].includes(process.env.PGHOST || "127.0.0.1")) {
  throw new Error("Refusing to run staff test without explicitly isolated local PostgreSQL");
}
const pgSettings={host:process.env.PGHOST||"127.0.0.1",
  port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||"tester",
  password:process.env.PGPASSWORD||"testonly",
  database:process.env.PGDATABASE||"staff_permissions_test"};
const hashToken = x => "sha256:" + createHash("sha256").update(x).digest("hex");
function request(p, method="GET", token=null, body=null) {
  const headers={};
  if(token)headers.Authorization="Bearer "+token;
  if(body)headers["Content-Type"]="application/json";
  return new Request("http://127.0.0.1"+p,
    {method,headers,...(body?{body:JSON.stringify(body)}:{})});
}
async function buildHandlers(){
  await build({entryPoints:[
    path.join(__dirname,"staff-access-routes.ts"),
    path.join(__dirname,"auth-routes.ts")],
    outdir:buildDir,outExtension:{".js":".mjs"},
    bundle:true,platform:"node",target:"node22",format:"esm",
    external:["bcryptjs","pg","drizzle-orm","drizzle-orm/*","drizzle-zod",
      "zod","zod/*","@clerk/backend"],logLevel:"warning"});
  const access=await import(pathToFileURL(path.join(buildDir,"staff-access-routes.mjs")).href);
  const auth=await import(pathToFileURL(path.join(buildDir,"auth-routes.mjs")).href);
  return {access:access.handleStaffAccessRequest,auth:auth.handleAuthRequest};
}
async function seed(client){
  await client.query([
    "CREATE TABLE public.users (id serial PRIMARY KEY, phone text UNIQUE, email text UNIQUE, name text NOT NULL, password_hash text, clerk_user_id text UNIQUE, avatar_url text, delivery_address text, is_admin boolean NOT NULL DEFAULT false, is_owner boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL DEFAULT now());",
    "CREATE TABLE public.sessions (token text PRIMARY KEY, user_id integer NOT NULL, created_at timestamp NOT NULL DEFAULT now());",
    "CREATE TABLE public.security_audit_logs (id serial PRIMARY KEY, actor_user_id integer REFERENCES public.users(id) ON DELETE SET NULL, target_user_id integer, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamp NOT NULL DEFAULT now());",
    "CREATE ROLE anon;",
    "CREATE ROLE authenticated;"
  ].join("\n"));
  // Run the actual production migration, but on disposable PostgreSQL.
  await client.query(fs.readFileSync(path.join(root,
    "lib/db/migrations/20261029_create_owner_managed_staff_access.sql"),"utf8"));
  const hash=await bcrypt.hash(OWNER_PWD,10);
  const owner=(await client.query("INSERT INTO users(name,phone,password_hash,is_owner) VALUES($1,$2,$3,true) RETURNING id",
    ["Test owner","0591000001",hash])).rows[0].id;
  const admin=(await client.query("INSERT INTO users(name,phone,password_hash,is_admin) VALUES($1,$2,$3,true) RETURNING id",
    ["Test admin","0591000002",hash])).rows[0].id;
  return {owner,admin};
}
test("owner-only staff API; login; grant revocation and disabled tokens", {timeout:180000}, async()=>{
  const client=new Client(pgSettings);
  await client.connect();
  try {
    const ids=await seed(client),db=drizzle(client),env={};
    const h=await buildHandlers();
    const ot="owner-"+randomUUID(), at="admin-"+randomUUID();
    await client.query("INSERT INTO sessions(token,user_id) VALUES($1,$2),($3,$4)",
      [hashToken(ot),ids.owner,hashToken(at),ids.admin]);
    const p="/api/pos/access/staff", a="/api/pos/access/audit";
    const sample={name:"Test cashier",phone:"0591000003",password:STAFF_PWD,
      roleName:"cashier",permissions:["sales.create","cash.view"],ownerPassword:OWNER_PWD};
    assert.equal((await h.access(request(p),db,env)).status,403);
    assert.equal((await h.access(request(p,"GET",at),db,env)).status,403);
    assert.equal((await h.access(request(p,"POST",at,sample),db,env)).status,403);
    assert.equal((await h.access(request(p,"POST",ot,{...sample,ownerPassword:"wrong"}),db,env)).status,401);
    assert.equal((await h.access(request(p,"POST",ot,{...sample,permissions:["purchases.edit"]}),db,env)).status,400);
    const created=await h.access(request(p,"POST",ot,sample),db,env);
    assert.equal(created.status,201,await created.clone().text());
    const record=await created.json(), sid=Number(record.id);
    assert.ok(Number.isSafeInteger(sid));
    assert.deepEqual(record.permissions,["sales.create","cash.view"]);
    const userRow=(await client.query("SELECT is_admin,is_owner FROM users WHERE id=$1",[sid])).rows[0];
    assert.deepEqual(userRow,{is_admin:false,is_owner:false});
    const login=()=>h.auth(request("/api/auth/login","POST",null,
      {phone:sample.phone,password:STAFF_PWD}),db,env);
    const l1=await login();
    assert.equal(l1.status,200,await l1.clone().text());
    const s1=await l1.json();
    assert.equal(s1.user.staffEnabled,true);
    assert.deepEqual(s1.user.permissions,["sales.create","cash.view"]);
    assert.equal((await h.access(request(p,"GET",s1.token),db,env)).status,403);
    assert.equal((await h.access(request(a,"GET",s1.token),db,env)).status,403);
    assert.equal((await h.access(request(p+"/"+sid,"PATCH",s1.token,
      {ownerPassword:OWNER_PWD,permissions:["sales.void"]}),db,env)).status,403);
    const list=await h.access(request(p,"GET",ot),db,env);
    assert.equal(list.status,200);
    assert.ok((await list.json()).some(x=>x.id===String(sid)));
    const audit=await h.access(request(a,"GET",ot),db,env);
    assert.equal(audit.status,200);
    assert.ok((await audit.json()).some(x=>x.action==="staff_created"));
    const changed=await h.access(request(p+"/"+sid,"PATCH",ot,
      {ownerPassword:OWNER_PWD,roleName:"accountant",permissions:["reports.financial"]}),db,env);
    assert.equal(changed.status,200,await changed.clone().text());
    assert.equal((await h.auth(request("/api/auth/me","GET",s1.token),db,env)).status,401);
    const l2=await login();
    assert.equal(l2.status,200);
    const s2=await l2.json();
    assert.deepEqual(s2.user.permissions,["reports.financial"]);
    assert.equal(s2.user.staffRole,"accountant");
    const disabled=await h.access(request(p+"/"+sid,"PATCH",ot,
      {ownerPassword:OWNER_PWD,enabled:false}),db,env);
    assert.equal(disabled.status,200,await disabled.clone().text());
    assert.equal((await h.auth(request("/api/auth/me","GET",s2.token),db,env)).status,401);
    assert.equal((await login()).status,403);
    const enabled=await h.access(request(p+"/"+sid,"PATCH",ot,
      {ownerPassword:OWNER_PWD,enabled:true}),db,env);
    assert.equal(enabled.status,200,await enabled.clone().text());
    assert.equal((await h.auth(request("/api/auth/me","GET",s2.token),db,env)).status,401);
    assert.equal((await login()).status,200);
    const sec=(await client.query("SELECT c.relrowsecurity AS rls, has_table_privilege('anon','public.staff_access','SELECT') AS anon_read,has_table_privilege('authenticated','public.staff_access','SELECT') AS auth_read FROM pg_class c WHERE c.oid='public.staff_access'::regclass")).rows[0];
    assert.deepEqual(sec,{rls:true,anon_read:false,auth_read:false});
    const logs=(await client.query("SELECT count(*)::int AS n FROM security_audit_logs WHERE action LIKE 'staff_%'")).rows[0];
    assert.equal(logs.n,4);
  } finally {
    await client.end();
    fs.rmSync(buildDir,{recursive:true,force:true});
  }
});