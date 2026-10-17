const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const APPROVAL = "APPLY_20261017_25754";
const IMPORT_KEY = "historical-customer-balances:20261017:v1";
const SOURCE_TYPE = "historical_customer_opening_balance";
const SOURCE_ID = "legacy-xls-customer-balances-20261017-v1";
const SOURCE_EVENT = "posted";
const OPENING_EQUITY_CODE = "OPENING_BALANCE_EQUITY";

const EXPECTED = {
  rows: 19,
  total: 25754,
  commercial: 4940,
  personal: 20814,
};

function fail(message) {
  console.error("❌ " + message);
  process.exitCode = 1;
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] || null) : null;
}

function getRepeatedArg(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) {
      values.push(process.argv[i + 1]);
      i += 1;
    }
  }
  return values;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(value) {
  return decodeXml(String(value || "").replace(/<[^>]+>/g, "")).trim();
}

function normalizeDigits(value) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const eastern = "۰۱۲۳۴۵۶۷۸۹";
  return String(value || "")
    .replace(/[٠-٩]/g, function (digit) { return String(arabic.indexOf(digit)); })
    .replace(/[۰-۹]/g, function (digit) { return String(eastern.indexOf(digit)); });
}

function normalizePhone(value) {
  return normalizeDigits(value).replace(/\D/g, "");
}

function restoredPhone(value) {
  const normalized = normalizePhone(value);
  if (normalized.length === 9 && normalized.startsWith("5")) {
    return "0" + normalized;
  }
  return normalized || null;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[.,،/\\()[\]{}:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function moneyMinor(value) {
  const minor = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new Error("رصيد غير صالح: " + value);
  }
  return minor;
}

function parseSpreadsheetXml(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");

  if (!raw.includes("<Workbook") || !raw.includes("<Worksheet")) {
    throw new Error("ملف Excel غير مدعوم.");
  }

  const rowMatches = Array.from(raw.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/g));
  if (rowMatches.length < 2) {
    throw new Error("لا توجد صفوف بيانات.");
  }

  const rows = rowMatches.map(function (rowMatch) {
    const rowBody = rowMatch[1];
    const cells = [];
    let nextIndex = 1;

    for (const cellMatch of rowBody.matchAll(/<Cell\b([^>]*)\/>|<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/g)) {
      const selfClosing = cellMatch[1] !== undefined;
      const attributes = selfClosing ? cellMatch[1] : (cellMatch[2] || "");
      const body = selfClosing ? "" : (cellMatch[3] || "");
      const explicitIndex = /ss:Index="(\d+)"/.exec(attributes);
      const index = explicitIndex ? Number(explicitIndex[1]) : nextIndex;

      while (cells.length < index - 1) {
        cells.push("");
      }

      const dataMatch = /<Data\b[^>]*>([\s\S]*?)<\/Data>/.exec(body);
      cells[index - 1] = dataMatch ? stripTags(dataMatch[1]) : "";
      nextIndex = index + 1;
    }

    return cells;
  });

  const headers = rows[0].map(function (value) { return String(value || "").trim(); });
  const headerIndex = new Map(headers.map(function (header, index) { return [header, index]; }));

  ["الاسم", "مدين", "دائن"].forEach(function (header) {
    if (!headerIndex.has(header)) {
      throw new Error("العمود المطلوب غير موجود: " + header);
    }
  });

  function getCell(cells, header) {
    const position = headerIndex.get(header);
    return position === undefined ? "" : String(cells[position] || "").trim();
  }

  function numberValue(value) {
    const normalized = normalizeDigits(value).replace(/,/g, "").trim();
    if (!normalized) return 0;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) {
      throw new Error("قيمة مالية غير صالحة: " + value);
    }
    return numeric;
  }

  return rows.slice(1).map(function (cells, index) {
    const debit = numberValue(getCell(cells, "مدين"));
    const credit = numberValue(getCell(cells, "دائن"));

    return {
      rowNumber: index + 2,
      sourceNumber: getCell(cells, "#"),
      name: getCell(cells, "الاسم"),
      phone: getCell(cells, "رقم الهاتف"),
      balance: debit - credit,
    };
  }).filter(function (row) {
    return row.name || row.balance !== 0;
  });
}

function parsePersonalRules() {
  return getRepeatedArg("--personal").map(function (raw) {
    const pieces = raw.split("::");
    const sourcePattern = String(pieces[0] || "").trim();
    const lookupName = String(pieces[1] || pieces[0] || "").trim();

    if (!sourcePattern || !lookupName) {
      throw new Error("قيمة --personal غير صالحة.");
    }

    return {
      sourcePattern: sourcePattern,
      normalizedPattern: normalizeName(sourcePattern),
      lookupName: lookupName,
    };
  });
}

function personalRuleFor(name, rules) {
  const normalized = normalizeName(name);
  return rules.find(function (rule) {
    return normalized === rule.normalizedPattern ||
      normalized.startsWith(rule.normalizedPattern + " ");
  }) || null;
}

function validateBusinessDate(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("حدد --business-date بصيغة YYYY-MM-DD.");
  }
  return normalized;
}

function customerCode(row, businessDate, isPersonal) {
  const source = String(row.sourceNumber || row.rowNumber).replace(/\D/g, "").padStart(3, "0").slice(-3);
  return "HIST_" + businessDate.replace(/-/g, "") + "_" + (isPersonal ? "PER" : "CUS") + "_" + source;
}

function personalCustomerName(rule, existingCustomer) {
  return (rule.lookupName || existingCustomer.name) + " - دين شخصي";
}

async function loadOwner(client) {
  const result = await client.query(
    "SELECT id, name FROM users WHERE is_owner = true ORDER BY id"
  );

  if (result.rows.length !== 1) {
    throw new Error("المتوقع مستخدم مالك واحد، الموجود: " + result.rows.length);
  }

  return result.rows[0];
}

async function findExistingCustomers(client) {
  const result = await client.query(
    "SELECT id, code, name, phone, status FROM customers ORDER BY id"
  );
  return result.rows;
}

async function currentCustomerReceivable(client, customerId) {
  const result = await client.query(
    "SELECT COALESCE(SUM(ftl.debit_minor - ftl.credit_minor), 0)::bigint AS balance_minor " +
    "FROM finance_transaction_lines ftl " +
    "JOIN finance_accounts fa ON fa.id = ftl.account_id " +
    "WHERE ftl.customer_id = $1 AND (" +
    "fa.code = 'CUSTOMER_RECEIVABLE_CONTROL' OR " +
    "(fa.linked_entity_type = 'customer_receivable' AND fa.linked_entity_id = $1)" +
    ")",
    [customerId]
  );
  return Number(result.rows[0].balance_minor || 0);
}

async function loadControlAccount(client) {
  const result = await client.query(
    "SELECT id, code, account_type, currency_code, status " +
    "FROM finance_accounts WHERE code = 'CUSTOMER_RECEIVABLE_CONTROL' LIMIT 1"
  );
  const account = result.rows[0];

  if (!account) {
    throw new Error("حساب CUSTOMER_RECEIVABLE_CONTROL غير موجود.");
  }

  if (account.account_type !== "asset" || account.currency_code !== "ILS" || account.status !== "active") {
    throw new Error("حساب ذمم الزبائن الرقابي غير صالح.");
  }

  return account;
}

async function ensureOpeningEquity(client) {
  const existing = await client.query(
    "SELECT id, code, account_type, currency_code, status " +
    "FROM finance_accounts WHERE code = $1 LIMIT 1",
    [OPENING_EQUITY_CODE]
  );

  if (existing.rows[0]) {
    const account = existing.rows[0];

    if (account.account_type !== "equity" || account.currency_code !== "ILS" || account.status !== "active") {
      throw new Error("حساب الرصيد الافتتاحي موجود بحالة غير صحيحة.");
    }

    return account;
  }

  const inserted = await client.query(
    "INSERT INTO finance_accounts " +
    "(code, name, account_type, linked_entity_type, linked_entity_id, currency_code, status, notes) " +
    "VALUES ($1, $2, 'equity', NULL, NULL, 'ILS', 'active', $3) " +
    "RETURNING id, code, account_type, currency_code, status",
    [
      OPENING_EQUITY_CODE,
      "حقوق الملكية - أرصدة افتتاحية",
      "Opening equity account for audited legacy opening-balance imports."
    ]
  );

  return inserted.rows[0];
}

async function assertImportNotPosted(client) {
  const result = await client.query(
    "SELECT id, public_id FROM finance_transactions " +
    "WHERE idempotency_key = $1 OR " +
    "(source_type = $2 AND source_id = $3 AND source_event = $4 AND status = 'posted') " +
    "LIMIT 1",
    [IMPORT_KEY, SOURCE_TYPE, SOURCE_ID, SOURCE_EVENT]
  );

  if (result.rows[0]) {
    throw new Error("الترحيل منفذ مسبقًا: " + result.rows[0].public_id);
  }
}

function classifyRows(rows, rules) {
  return rows.map(function (row) {
    const personalRule = personalRuleFor(row.name, rules);
    return Object.assign({}, row, {
      personalRule: personalRule,
      classification: personalRule ? "personal" : "commercial",
      proposedPhone: restoredPhone(row.phone),
    });
  });
}

function assertSourceTotals(rows) {
  const total = rows.reduce(function (sum, row) { return sum + row.balance; }, 0);
  const commercial = rows.filter(function (row) { return row.classification === "commercial"; })
    .reduce(function (sum, row) { return sum + row.balance; }, 0);
  const personal = rows.filter(function (row) { return row.classification === "personal"; })
    .reduce(function (sum, row) { return sum + row.balance; }, 0);

  if (rows.length !== EXPECTED.rows ||
      total !== EXPECTED.total ||
      commercial !== EXPECTED.commercial ||
      personal !== EXPECTED.personal) {
    throw new Error(
      "ملف المصدر لا يطابق الـDry Run المعتمد. rows=" + rows.length +
      " total=" + total + " commercial=" + commercial + " personal=" + personal
    );
  }

  rows.forEach(function (row) {
    if (!Number.isFinite(row.balance) || row.balance <= 0) {
      throw new Error("رصيد غير موجب في الصف " + (row.sourceNumber || row.rowNumber));
    }
  });
}

async function buildPlan(client, classifiedRows, existingCustomers, businessDate) {
  const plan = [];

  for (const row of classifiedRows) {
    if (row.classification === "personal") {
      const lookup = normalizeName(row.personalRule.lookupName);
      const matches = existingCustomers.filter(function (customer) {
        return normalizeName(customer.name) === lookup;
      });

      if (matches.length !== 1) {
        throw new Error(
          "تعذر مطابقة حساب المبيعات للدين الشخصي: " + row.personalRule.lookupName +
          " (matches=" + matches.length + ")"
        );
      }

      const existingSalesCustomer = matches[0];
      const proposedName = personalCustomerName(row.personalRule, existingSalesCustomer);

      plan.push({
        row: row,
        existingSalesCustomer: existingSalesCustomer,
        existingSalesBalanceMinor: await currentCustomerReceivable(client, Number(existingSalesCustomer.id)),
        proposedName: proposedName,
        proposedCode: customerCode(row, businessDate, true),
        proposedPhone: null,
      });

      continue;
    }

    const normalizedName = normalizeName(row.name);
    const phone = row.proposedPhone;

    const conflicts = existingCustomers.filter(function (customer) {
      const sameName = normalizeName(customer.name) === normalizedName;
      const samePhone = phone && normalizePhone(customer.phone) === normalizePhone(phone);
      return sameName || samePhone;
    });

    if (conflicts.length > 0) {
      throw new Error(
        "صف تجاري أصبح يطابق حسابًا موجودًا بعد الـDry Run: " +
        row.name + " -> #" + conflicts[0].id + " " + conflicts[0].name
      );
    }

    plan.push({
      row: row,
      existingSalesCustomer: null,
      existingSalesBalanceMinor: null,
      proposedName: row.name.trim(),
      proposedCode: customerCode(row, businessDate, false),
      proposedPhone: phone,
    });
  }

  for (const item of plan) {
    const result = await client.query(
      "SELECT id, code, name, phone FROM customers " +
      "WHERE code = $1 OR lower(btrim(name)) = lower(btrim($2)) OR " +
      "($3::text IS NOT NULL AND regexp_replace(coalesce(phone,''), '\\D', '', 'g') = regexp_replace($3, '\\D', '', 'g')) " +
      "LIMIT 1",
      [item.proposedCode, item.proposedName, item.proposedPhone]
    );

    if (result.rows[0]) {
      throw new Error(
        "الحساب المقترح يتعارض مع حساب موجود: " +
        item.proposedName + " -> #" + result.rows[0].id + " " + result.rows[0].name
      );
    }
  }

  return plan;
}

async function createCustomer(client, item, ownerId) {
  const note = item.row.classification === "personal"
    ? "دين شخصي تاريخي منفصل عن حساب المبيعات #" + item.existingSalesCustomer.id +
      " (" + item.existingSalesCustomer.code + "). رصيد افتتاحي مرحّل من النظام السابق."
    : "ذمة مبيعات تاريخية - رصيد افتتاحي مرحّل من النظام السابق.";

  const result = await client.query(
    "INSERT INTO customers " +
    "(code, name, phone, address, notes, credit_limit_minor, status, created_by_user_id) " +
    "VALUES ($1, $2, $3, NULL, $4, NULL, 'active', $5) " +
    "RETURNING id, code, name, phone, notes",
    [item.proposedCode, item.proposedName, item.proposedPhone, note, ownerId]
  );

  return result.rows[0];
}

async function insertOpeningPosting(client, plan, createdCustomers, controlAccount, openingEquity, ownerId, businessDate) {
  const totalMinor = plan.reduce(function (sum, item) {
    return sum + moneyMinor(item.row.balance);
  }, 0);

  const publicId = "OPEN-" + businessDate.replace(/-/g, "") + "-CUST-HIST";

  const txResult = await client.query(
    "INSERT INTO finance_transactions " +
    "(public_id, idempotency_key, business_date, transaction_type, source_type, source_id, source_event, cash_session_id, status, notes, created_by_user_id) " +
    "VALUES ($1, $2, $3, 'adjustment', $4, $5, $6, NULL, 'posted', $7, $8) " +
    "RETURNING id, public_id, business_date",
    [
      publicId,
      IMPORT_KEY,
      businessDate,
      SOURCE_TYPE,
      SOURCE_ID,
      SOURCE_EVENT,
      "ترحيل أرصدة تاريخية: 4,940 ₪ ذمم مبيعات + 20,814 ₪ ديون شخصية منفصلة.",
      ownerId
    ]
  );

  const financeTransaction = txResult.rows[0];
  let lineNumber = 1;

  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i];
    const customer = createdCustomers[i];
    const amountMinor = moneyMinor(item.row.balance);
    const memo = item.row.classification === "personal"
      ? "رصيد افتتاحي - دين شخصي - " + customer.name
      : "رصيد افتتاحي - ذمة تاريخية - " + customer.name;

    await client.query(
      "INSERT INTO finance_transaction_lines " +
      "(transaction_id, line_number, account_id, customer_id, employee_id, supplier_id, currency_code, currency_amount_minor, exchange_rate_micros, debit_minor, credit_minor, memo) " +
      "VALUES ($1, $2, $3, $4, NULL, NULL, 'ILS', $5, 1000000, $5, 0, $6)",
      [
        Number(financeTransaction.id),
        lineNumber,
        Number(controlAccount.id),
        Number(customer.id),
        amountMinor,
        memo
      ]
    );

    lineNumber += 1;
  }

  await client.query(
    "INSERT INTO finance_transaction_lines " +
    "(transaction_id, line_number, account_id, customer_id, employee_id, supplier_id, currency_code, currency_amount_minor, exchange_rate_micros, debit_minor, credit_minor, memo) " +
    "VALUES ($1, $2, $3, NULL, NULL, NULL, 'ILS', $4, 1000000, 0, $4, $5)",
    [
      Number(financeTransaction.id),
      lineNumber,
      Number(openingEquity.id),
      totalMinor,
      "مقابل الأرصدة الافتتاحية للذمم التاريخية"
    ]
  );

  const check = await client.query(
    "SELECT COALESCE(SUM(debit_minor),0)::bigint AS debit_minor, " +
    "COALESCE(SUM(credit_minor),0)::bigint AS credit_minor, COUNT(*)::integer AS line_count " +
    "FROM finance_transaction_lines WHERE transaction_id = $1",
    [Number(financeTransaction.id)]
  );

  const debit = Number(check.rows[0].debit_minor);
  const credit = Number(check.rows[0].credit_minor);
  const lineCount = Number(check.rows[0].line_count);

  if (debit !== totalMinor || credit !== totalMinor || lineCount !== plan.length + 1) {
    throw new Error(
      "فشل تحقق القيد قبل COMMIT: Dr=" + debit + " Cr=" + credit + " lines=" + lineCount
    );
  }

  return {
    financeTransaction: financeTransaction,
    totalMinor: totalMinor,
    lineCount: lineCount,
  };
}

async function verifyNewBalances(client, plan, createdCustomers, controlAccount) {
  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i];
    const customer = createdCustomers[i];
    const expected = moneyMinor(item.row.balance);

    const result = await client.query(
      "SELECT COALESCE(SUM(debit_minor - credit_minor),0)::bigint AS balance_minor " +
      "FROM finance_transaction_lines WHERE account_id = $1 AND customer_id = $2",
      [Number(controlAccount.id), Number(customer.id)]
    );

    const actual = Number(result.rows[0].balance_minor);
    if (actual !== expected) {
      throw new Error(
        "فشل تحقق رصيد " + customer.name + ": expected=" + expected + " actual=" + actual
      );
    }
  }
}

async function main() {
  if (!process.argv.includes("--apply")) {
    throw new Error("هذه الأداة لا تعمل إلا مع --apply.");
  }

  if (process.env.LOVELY_KIDS_HISTORICAL_BALANCES_APPROVAL !== APPROVAL) {
    throw new Error(
      "رفض التنفيذ: متغير الموافقة الصريح غير مضبوط على " + APPROVAL
    );
  }

  const inputArg = getArg("--input");
  if (!inputArg) {
    throw new Error("حدد --input.");
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  if (!fs.existsSync(inputPath)) {
    throw new Error("ملف الإدخال غير موجود: " + inputPath);
  }

  const businessDate = validateBusinessDate(getArg("--business-date"));
  const personalRules = parsePersonalRules();

  if (personalRules.length !== 2) {
    throw new Error("يجب تحديد ذمتين شخصيتين بالضبط.");
  }

  const rows = classifyRows(parseSpreadsheetXml(inputPath), personalRules);
  assertSourceTotals(rows);

  const sourceHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(inputPath))
    .digest("hex");

  const client = new Client({
    connectionString: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL,
  });

  if (!client.connectionParameters.connectionString && !process.env.SUPABASE_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL أو SUPABASE_DATABASE_URL غير مضبوط.");
  }

  await client.connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('lovely-kids-historical-customer-balances-v1'))"
    );
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");

    await assertImportNotPosted(client);

    const owner = await loadOwner(client);
    const existingCustomers = await findExistingCustomers(client);
    const plan = await buildPlan(client, rows, existingCustomers, businessDate);
    const controlAccount = await loadControlAccount(client);
    const openingEquity = await ensureOpeningEquity(client);

    const createdCustomers = [];
    for (const item of plan) {
      createdCustomers.push(
        await createCustomer(client, item, Number(owner.id))
      );
    }

    const posting = await insertOpeningPosting(
      client,
      plan,
      createdCustomers,
      controlAccount,
      openingEquity,
      Number(owner.id),
      businessDate
    );

    await verifyNewBalances(
      client,
      plan,
      createdCustomers,
      controlAccount
    );

    await client.query("COMMIT");

    const report = {
      mode: "apply",
      appliedAt: new Date().toISOString(),
      businessDate: businessDate,
      inputFile: path.basename(inputPath),
      inputSha256: sourceHash,
      sourceTotals: EXPECTED,
      financeTransaction: {
        id: Number(posting.financeTransaction.id),
        publicId: posting.financeTransaction.public_id,
        total: posting.totalMinor / 100,
        lineCount: posting.lineCount,
      },
      openingEquityAccount: {
        id: Number(openingEquity.id),
        code: openingEquity.code,
      },
      createdCustomers: createdCustomers.map(function (customer, index) {
        const item = plan[index];
        return {
          id: Number(customer.id),
          code: customer.code,
          name: customer.name,
          phone: customer.phone,
          type: item.row.classification,
          openingBalance: item.row.balance,
          existingSalesCustomerId: item.existingSalesCustomer
            ? Number(item.existingSalesCustomer.id)
            : null,
          existingSalesBalanceBeforeImport: item.existingSalesBalanceMinor === null
            ? null
            : item.existingSalesBalanceMinor / 100,
        };
      }),
    };

    const outputArg = getArg("--output");
    if (outputArg) {
      const outputPath = path.resolve(process.cwd(), outputArg);
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      console.log("✅ Apply report written: " + outputPath);
    }

    console.log("");
    console.log("✅ Historical balances import COMMITTED successfully.");
    console.log("✅ Created customer accounts: " + createdCustomers.length);
    console.log("✅ Opening transaction: " + posting.financeTransaction.public_id);
    console.log("✅ Total opening receivables: " + (posting.totalMinor / 100).toFixed(2) + " ILS");
    console.log("✅ Existing sales accounts for محمود الصراوي and فاتح حجازي were not edited.");
    console.log("✅ Cash, banks, and sales revenue were not touched.");
  } catch (error) {
    await client.query("ROLLBACK").catch(function () {});
    throw error;
  } finally {
    await client.end().catch(function () {});
  }
}

main().catch(function (error) {
  fail(error instanceof Error ? error.message : String(error));
});
