import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Isolate the actual TS permission implementation from the database package's
// extensionless schema imports. Real Drizzle query behavior is tested elsewhere.
const moduleSource = readFileSync(new URL("./staff-permissions.ts", import.meta.url), "utf8")
  .replace('import { staffAccessTable } from "@workspace/db/schema";', 'const staffAccessTable = { userId: "staff_user_id" };')
  .replace('import { eq } from "drizzle-orm";', 'const eq = () => true;')
  .replace('import type { openDb } from "./db";', "");
const compiled = ts.transpileModule(moduleSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const {
  STAFF_PERMISSION_KEYS, validateStaffPermissions, userHasPermission,
  userHasAnyPermission, getStaffLoginProfile,
} = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

const owner = { id: 1, isOwner: true, isAdmin: false };
const admin = { id: 2, isOwner: false, isAdmin: true };
const cashier = { id: 3, isOwner: false, isAdmin: false };

function dbFor(record) {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() { return record ? [record] : []; },
              };
            },
          };
        },
      };
    },
  };
}

test("permission inputs reject unknown and unsupported grant keys", () => {
  assert.ok(STAFF_PERMISSION_KEYS.includes("vouchers.create"));
  assert.ok(!STAFF_PERMISSION_KEYS.includes("purchases.edit"));
  assert.deepEqual(validateStaffPermissions(["sales.create", "sales.create", "cash.view"]), ["sales.create", "cash.view"]);
  for (const input of [null, "sales.create", ["purchases.edit"], ["admin"], [123], Array(200).fill("sales.create")]) {
    assert.equal(validateStaffPermissions(input), null);
  }
});

test("owner and existing admin keep prior privileges", async () => {
  const db = dbFor(null);
  assert.equal(await userHasPermission(db, owner, "vouchers.void"), true);
  assert.equal(await userHasPermission(db, admin, "vouchers.void"), true);
  assert.equal(await userHasAnyPermission(db, owner, ["sales.void"]), true);
});

test("independent staff grants do not imply reversal privileges", async () => {
  const db = dbFor({ enabled: true, roleName: "cashier", permissions: ["sales.create", "vouchers.create", "banking.view"] });
  assert.equal(await userHasPermission(db, cashier, "sales.create"), true);
  assert.equal(await userHasPermission(db, cashier, "sales.void"), false);
  assert.equal(await userHasPermission(db, cashier, "vouchers.void"), false);
  assert.equal(await userHasPermission(db, cashier, "banking.create"), false);
  assert.equal(await userHasAnyPermission(db, cashier, ["sales.returns", "sales.void"]), false);
  assert.equal(await userHasAnyPermission(db, cashier, ["sales.returns", "sales.create"]), true);
});

test("disabled and unregistered staff receive no grants", async () => {
  const revoked = dbFor({ enabled: false, roleName: "cashier", permissions: ["sales.create", "cash.close"] });
  const absent = dbFor(null);
  assert.equal(await userHasPermission(revoked, cashier, "sales.create"), false);
  assert.equal(await userHasAnyPermission(revoked, cashier, ["sales.create", "cash.close"]), false);
  assert.deepEqual((await getStaffLoginProfile(revoked, cashier)).permissions, []);
  assert.equal((await getStaffLoginProfile(revoked, cashier)).staffEnabled, false);
  assert.equal(await userHasPermission(absent, cashier, "sales.create"), false);
});
