const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const MIGRATIONS = [
  "20260801_add_pos_discount_breakdown.sql",
  "20260801_create_pos_sale_revisions.sql",
  "20260801_harden_app_sql_migrations.sql",
  "20260802_create_suppliers_and_pos_purchases.sql",
];

const SQL_DIRECTORY = path.resolve(__dirname, "../sql");

const MIGRATION_TABLE = "public.app_sql_migrations";

const MIGRATION_LOCK_NAME = "lovely-kids-pos-schema-migrations";

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function getMode() {
  const modes = ["--plan", "--preflight", "--apply"].filter((flag) =>
    process.argv.includes(flag),
  );

  if (modes.length > 1) {
    throw new Error(
      "استخدم وضعًا واحدًا فقط: --plan أو --preflight أو --apply",
    );
  }

  return modes[0] ?? "--plan";
}

function getArgument(name) {
  const index = process.argv.indexOf(name);

  if (index < 0) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function readMigration(name) {
  const filePath = path.join(SQL_DIRECTORY, name);

  if (!fs.existsSync(filePath)) {
    throw new Error(`ملف Migration غير موجود: ${name}`);
  }

  const sql = fs.readFileSync(filePath, "utf8");

  if (!/^\s*BEGIN\s*;/i.test(sql) || !/COMMIT\s*;\s*$/i.test(sql)) {
    throw new Error(`يجب أن يبدأ وينتهي Migration بمعاملة واضحة: ${name}`);
  }

  const body = sql
    .replace(/^\s*BEGIN\s*;\s*/i, "")
    .replace(/\s*COMMIT\s*;\s*$/i, "")
    .trim();

  if (!body) {
    throw new Error(`ملف Migration فارغ: ${name}`);
  }

  if (/\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(body)) {
    throw new Error(`يحتوي Migration على معاملة داخلية غير مسموحة: ${name}`);
  }

  return {
    name,
    path: filePath,
    sql,
    body,
    checksum: sha256(sql),
  };
}

function loadMigrations() {
  return MIGRATIONS.map(readMigration);
}

function getDatabaseUrl() {
  const databaseUrl =
    process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL أو SUPABASE_DATABASE_URL غير مضبوط");
  }

  return databaseUrl;
}

function printPlan(migrations) {
  console.log("=== خطة POS Migrations ===");

  for (const [index, migration] of migrations.entries()) {
    console.log(`${index + 1}. ${migration.name}`);

    console.log(`   SHA-256: ${migration.checksum}`);

    console.log(`   الحجم: ${Buffer.byteLength(migration.sql, "utf8")} bytes`);
  }

  console.log();
  console.log("✅ تم فحص ترتيب وبنية ملفات Migration");

  console.log("✅ لم يتم الاتصال بقاعدة البيانات");

  console.log("✅ لم يتم تنفيذ أي SQL");
}

async function runPreflight(migrations) {
  const client = new Client({
    connectionString: getDatabaseUrl(),
  });

  await client.connect();

  try {
    await client.query("BEGIN READ ONLY");

    await client.query("SET LOCAL statement_timeout = '30s'");

    const prerequisites = await client.query(`
        SELECT
          to_regclass('public.pos_sales') IS NOT NULL
            AS pos_sales_exists,

          to_regclass('public.pos_sale_items') IS NOT NULL
            AS pos_sale_items_exists,

          to_regclass('public.pos_sale_return_items') IS NOT NULL
            AS pos_sale_return_items_exists,

          to_regclass('public.users') IS NOT NULL
            AS users_exists,

          to_regclass('public.pos_sale_revisions') IS NOT NULL
            AS revisions_exists,

          to_regclass('public.app_sql_migrations') IS NOT NULL
            AS migration_history_exists
      `);

    const invalidSales = await client.query(`
        SELECT count(*)::integer AS count
        FROM public.pos_sales
        WHERE
          subtotal_minor < 0
          OR discount_minor < 0
          OR total_minor < 0
          OR paid_minor < 0
          OR change_minor < 0
          OR total_minor <>
            subtotal_minor - discount_minor
      `);

    const invalidItems = await client.query(`
        SELECT count(*)::integer AS count
        FROM public.pos_sale_items
        WHERE
          website_unit_price_minor < 0
          OR sold_unit_price_minor < 0
          OR line_discount_minor < 0
          OR line_total_minor < 0
          OR line_discount_minor >
            sold_unit_price_minor * quantity
          OR line_total_minor <>
            sold_unit_price_minor * quantity
            - line_discount_minor
      `);

    const invalidReturnItems = await client.query(`
        SELECT count(*)::integer AS count
        FROM public.pos_sale_return_items
        WHERE
          sold_unit_price_minor < 0
          OR gross_amount_minor < 0
          OR allocated_discount_minor < 0
          OR refund_amount_minor < 0
          OR allocated_discount_minor >
            gross_amount_minor
          OR refund_amount_minor <>
            gross_amount_minor -
            allocated_discount_minor
      `);

    await client.query("ROLLBACK");

    const state = prerequisites.rows[0];

    console.log("=== فحص قاعدة البيانات للقراءة فقط ===");

    console.log(`pos_sales: ${state.pos_sales_exists ? "موجود" : "غير موجود"}`);

    console.log(
      `pos_sale_items: ${state.pos_sale_items_exists ? "موجود" : "غير موجود"}`,
    );

    console.log(
      `pos_sale_return_items: ${
        state.pos_sale_return_items_exists ? "موجود" : "غير موجود"
      }`,
    );

    console.log(`users: ${state.users_exists ? "موجود" : "غير موجود"}`);

    console.log(
      `pos_sale_revisions: ${
        state.revisions_exists ? "موجود مسبقًا" : "غير موجود"
      }`,
    );

    console.log(
      `سجل Migrations: ${
        state.migration_history_exists ? "موجود" : "غير موجود"
      }`,
    );

    console.log(`صفوف مبيعات غير متوافقة: ${invalidSales.rows[0].count}`);

    console.log(`بنود بيع غير متوافقة: ${invalidItems.rows[0].count}`);

    console.log(
      `بنود مرتجعات غير متوافقة: ${invalidReturnItems.rows[0].count}`,
    );

    const missingPrerequisite =
      !state.pos_sales_exists ||
      !state.pos_sale_items_exists ||
      !state.pos_sale_return_items_exists ||
      !state.users_exists;

    const invalidData =
      invalidSales.rows[0].count > 0 ||
      invalidItems.rows[0].count > 0 ||
      invalidReturnItems.rows[0].count > 0;

    if (missingPrerequisite) {
      throw new Error("قاعدة البيانات تفتقد جدولًا مطلوبًا");
    }

    if (invalidData) {
      throw new Error("توجد بيانات قد تفشل معها القيود الجديدة");
    }

    console.log();
    console.log(`✅ ملفات الخطة: ${migrations.length}`);

    console.log("✅ اكتمل Preflight بوضع القراءة فقط");
  } finally {
    await client.end();
  }
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS
      ${MIGRATION_TABLE} (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz
          NOT NULL DEFAULT now()
      )
  `);
}

async function applyMigrations(migrations) {
  const approval = process.env.LOVELY_KIDS_MIGRATION_APPROVAL;

  if (approval !== "APPLY_POS_20260802") {
    throw new Error("رفض التنفيذ: متغير الموافقة الصريح غير مضبوط");
  }

  const target = getArgument("--target");

  if (target !== MIGRATIONS[MIGRATIONS.length - 1]) {
    throw new Error("رفض التنفيذ: يجب تحديد آخر Migration كهدف صريح");
  }

  const targetIndex = MIGRATIONS.indexOf(target);

  const selected = migrations.slice(0, targetIndex + 1);

  const client = new Client({
    connectionString: getDatabaseUrl(),
  });

  await client.connect();

  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      MIGRATION_LOCK_NAME,
    ]);

    lockAcquired = true;

    await ensureMigrationTable(client);

    for (const migration of selected) {
      const existing = await client.query(
        `
            SELECT checksum
            FROM ${MIGRATION_TABLE}
            WHERE name = $1
          `,
        [migration.name],
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== migration.checksum) {
          throw new Error(
            `تغيرت بصمة Migration منفذ سابقًا: ${migration.name}`,
          );
        }

        console.log(`↷ متجاوز لأنه منفذ مسبقًا: ${migration.name}`);

        continue;
      }

      console.log(`→ تنفيذ: ${migration.name}`);

      await client.query("BEGIN");

      try {
        await client.query("SET LOCAL lock_timeout = '10s'");

        await client.query("SET LOCAL statement_timeout = '120s'");

        await client.query(migration.body);

        await client.query(
          `
            INSERT INTO ${MIGRATION_TABLE}
              (name, checksum)
            VALUES ($1, $2)
          `,
          [migration.name, migration.checksum],
        );

        await client.query("COMMIT");

        console.log(`✓ اكتمل: ${migration.name}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);

        throw error;
      }
    }

    console.log();
    console.log("✅ اكتمل تنفيذ POS Migrations");
  } finally {
    if (lockAcquired) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_NAME])
        .catch(() => undefined);
    }

    await client.end();
  }
}

async function main() {
  const mode = getMode();

  const migrations = loadMigrations();

  if (mode === "--plan") {
    printPlan(migrations);
    return;
  }

  if (mode === "--preflight") {
    await runPreflight(migrations);
    return;
  }

  await applyMigrations(migrations);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
