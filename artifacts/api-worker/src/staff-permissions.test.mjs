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
  assert.ok(STAFF_PERMISSION_KEYS.includes("delivery.view"));
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


test("staff navigation gates exactly the authorized POS pages", async () => {
  const source = readFileSync(new URL("../../lovely-kids-pos/src/guards/RequireStaffPage.tsx", import.meta.url), "utf8");
  const start = source.indexOf("export function canVisitStaffPage");
  const end = source.indexOf("export default function RequireStaffPage");
  assert.ok(start >= 0 && end > start, "Expected page-policy exports");
  const policy = ts.transpileModule(source.slice(start, end),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { canVisitStaffPage, firstAuthorizedStaffPage } =
    await import("data:text/javascript;base64," + Buffer.from(policy).toString("base64"));
  const cashier = ["sales.create", "cash.view"];
  assert.equal(canVisitStaffPage("/sales/pos", cashier), true);
  assert.equal(canVisitStaffPage("/cash-session", cashier), true);
  assert.equal(canVisitStaffPage("/vouchers/receipt", cashier), false);
  assert.equal(canVisitStaffPage("/purchases/new", cashier), false);
  assert.equal(canVisitStaffPage("/reports/trial-balance", cashier), false);
  assert.equal(canVisitStaffPage("/orders", cashier), false);
  assert.equal(firstAuthorizedStaffPage(cashier), "/sales/pos");

  const accountant = ["reports.financial"];
  assert.equal(canVisitStaffPage("/reports/trial-balance", accountant), true);
  assert.equal(canVisitStaffPage("/reports", accountant), false);
  assert.equal(canVisitStaffPage("/reports/financial-statements", accountant), false);
  assert.equal(canVisitStaffPage("/vouchers/journal", accountant), false);

  const inventory = ["inventory.view"];
  assert.equal(canVisitStaffPage("/inventory/products", inventory), true);
  assert.equal(canVisitStaffPage("/inventory/products/12/edit", inventory), false);
  assert.equal(canVisitStaffPage("/inventory/products/12/edit", ["inventory.edit"]), true);
  assert.equal(canVisitStaffPage("/finance/delivery-company", ["delivery.view"]), true);
  assert.equal(canVisitStaffPage("/finance/expenses", ["vouchers.create"]), true);
  assert.equal(canVisitStaffPage("/vouchers/register", ["vouchers.create"]), false);
});
