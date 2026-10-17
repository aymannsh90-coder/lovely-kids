const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function getRepeatedArg(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(value) {
  return decodeXml(String(value ?? "").replace(/<[^>]+>/g, "")).trim();
}

function normalizeArabicDigits(value) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const eastern = "۰۱۲۳۴۵۶۷۸۹";
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(eastern.indexOf(digit)));
}

function normalizePhone(value) {
  return normalizeArabicDigits(value).replace(/\D/g, "");
}

function normalizeName(value) {
  return String(value ?? "")
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

function levenshtein(left, right) {
  const a = [...left];
  const b = [...right];
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }

  return previous[b.length];
}

function nameSimilarity(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const maxLength = Math.max([...a].length, [...b].length);
  const editScore = 1 - levenshtein(a, b) / maxLength;

  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const tokenScore = union > 0 ? intersection / union : 0;

  return Math.max(editScore, 0.65 * editScore + 0.35 * tokenScore);
}

function parseSpreadsheetXml(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");

  if (!raw.includes("<Workbook") || !raw.includes("<Worksheet")) {
    throw new Error(
      "الملف ليس Excel XML Spreadsheet 2003. صدّر الملف كـ .xls XML أو .xlsx ثم حوّله إلى CSV قبل استخدام هذه الأداة.",
    );
  }

  const rowMatches = [...raw.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/g)];
  if (rowMatches.length < 2) {
    throw new Error("لم يتم العثور على صفوف بيانات في ملف Excel.");
  }

  const rows = rowMatches.map((rowMatch) => {
    const rowBody = rowMatch[1];
    const cells = [];
    let nextIndex = 1;

    // Match self-closing cells first. If the normal-cell alternative comes
    // first, "<Cell .../>" can consume the next closing Cell and shift columns.
    for (const cellMatch of rowBody.matchAll(/<Cell\b([^>]*)\/>|<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/g)) {
      const isSelfClosing = cellMatch[1] !== undefined;
      const attributes = isSelfClosing
        ? cellMatch[1]
        : cellMatch[2] ?? "";
      const body = isSelfClosing
        ? ""
        : cellMatch[3] ?? "";
      const explicitIndex = /ss:Index="(\d+)"/.exec(attributes);
      const index = explicitIndex ? Number(explicitIndex[1]) : nextIndex;

      while (cells.length < index - 1) cells.push("");

      const dataMatch = /<Data\b[^>]*>([\s\S]*?)<\/Data>/.exec(body);
      cells[index - 1] = dataMatch ? stripTags(dataMatch[1]) : "";
      nextIndex = index + 1;
    }

    return cells;
  });

  const headers = rows[0].map((value) => value.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));

  const required = ["الاسم", "مدين", "دائن"];
  for (const header of required) {
    if (!headerIndex.has(header)) {
      throw new Error(`العمود المطلوب غير موجود: ${header}`);
    }
  }

  const numberValue = (value) => {
    const normalized = normalizeArabicDigits(value)
      .replace(/,/g, "")
      .trim();

    if (!normalized) return 0;

    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) {
      throw new Error(`قيمة مالية غير صالحة: ${value}`);
    }
    return numeric;
  };

  return rows.slice(1).map((cells, index) => {
    const get = (header) => {
      const position = headerIndex.get(header);
      return position === undefined ? "" : String(cells[position] ?? "").trim();
    };

    const debit = numberValue(get("مدين"));
    const credit = numberValue(get("دائن"));
    const balance = debit - credit;

    return {
      rowNumber: index + 2,
      sourceNumber: get("#"),
      name: get("الاسم"),
      phone: get("رقم الهاتف"),
      debit,
      credit,
      balance,
      lastInvoiceDate: get("تاريخ اخر فاتوره"),
      lastVoucherDate: get("تاريخ اخر سند قبض / صرف"),
    };
  }).filter((row) => row.name || row.balance !== 0);
}

function parsePersonalRules() {
  const rawRules = getRepeatedArg("--personal");
  return rawRules.map((raw) => {
    const [sourcePattern, lookupName] = raw.split("::");
    const normalizedPattern = normalizeName(sourcePattern);
    if (!normalizedPattern) {
      throw new Error("قيمة --personal غير صالحة.");
    }
    return {
      sourcePattern: sourcePattern.trim(),
      normalizedPattern,
      lookupName: (lookupName ?? sourcePattern).trim(),
    };
  });
}

function personalRuleFor(rowName, rules) {
  const normalized = normalizeName(rowName);
  return rules.find((rule) =>
    normalized === rule.normalizedPattern ||
    normalized.startsWith(rule.normalizedPattern + " "),
  ) ?? null;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function minorToMoney(value) {
  return money(value / 100);
}

function getDatabaseUrl() {
  const databaseUrl =
    process.env.SUPABASE_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL أو SUPABASE_DATABASE_URL غير مضبوط.");
  }

  return databaseUrl;
}

async function loadCustomers(client) {
  const result = await client.query(`
    WITH legacy AS (
      SELECT
        fa.linked_entity_id AS customer_id,
        COALESCE(SUM(ftl.debit_minor - ftl.credit_minor), 0)::bigint AS balance_minor,
        MAX(ft.business_date) AS latest_business_date
      FROM finance_accounts fa
      JOIN finance_transaction_lines ftl
        ON ftl.account_id = fa.id
      JOIN finance_transactions ft
        ON ft.id = ftl.transaction_id
      WHERE
        fa.linked_entity_type = 'customer_receivable'
        AND fa.linked_entity_id IS NOT NULL
      GROUP BY fa.linked_entity_id
    ),
    control AS (
      SELECT
        ftl.customer_id,
        COALESCE(SUM(ftl.debit_minor - ftl.credit_minor), 0)::bigint AS balance_minor,
        MAX(ft.business_date) AS latest_business_date
      FROM finance_accounts fa
      JOIN finance_transaction_lines ftl
        ON ftl.account_id = fa.id
      JOIN finance_transactions ft
        ON ft.id = ftl.transaction_id
      WHERE
        fa.code = 'CUSTOMER_RECEIVABLE_CONTROL'
        AND ftl.customer_id IS NOT NULL
      GROUP BY ftl.customer_id
    ),
    personal AS (
      SELECT
        fa.linked_entity_id AS customer_id,
        fa.id AS account_id,
        fa.code AS account_code,
        fa.name AS account_name,
        COALESCE(SUM(ftl.debit_minor - ftl.credit_minor), 0)::bigint AS balance_minor
      FROM finance_accounts fa
      LEFT JOIN finance_transaction_lines ftl
        ON ftl.account_id = fa.id
      WHERE
        fa.linked_entity_type = 'customer_personal_receivable'
        AND fa.linked_entity_id IS NOT NULL
      GROUP BY
        fa.linked_entity_id,
        fa.id,
        fa.code,
        fa.name
    )
    SELECT
      c.id,
      c.code,
      c.name,
      c.phone,
      c.status,
      (
        COALESCE(legacy.balance_minor, 0)
        + COALESCE(control.balance_minor, 0)
      )::bigint AS receivable_balance_minor,
      GREATEST(
        legacy.latest_business_date,
        control.latest_business_date
      ) AS latest_receivable_business_date,
      personal.account_id AS personal_account_id,
      personal.account_code AS personal_account_code,
      personal.account_name AS personal_account_name,
      COALESCE(personal.balance_minor, 0)::bigint AS personal_balance_minor
    FROM customers c
    LEFT JOIN legacy ON legacy.customer_id = c.id
    LEFT JOIN control ON control.customer_id = c.id
    LEFT JOIN personal ON personal.customer_id = c.id
    ORDER BY c.name, c.id
  `);

  return result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    receivable_balance_minor: Number(row.receivable_balance_minor ?? 0),
    personal_balance_minor: Number(row.personal_balance_minor ?? 0),
  }));
}

function buildCandidates(row, customers, lookupNameOverride) {
  const lookupName = lookupNameOverride || row.name;
  const normalizedLookup = normalizeName(lookupName);
  const normalizedPhone = normalizePhone(row.phone);

  const phoneMatches = normalizedPhone
    ? customers.filter((customer) => normalizePhone(customer.phone) === normalizedPhone)
    : [];

  const exactNameMatches = customers.filter(
    (customer) => normalizeName(customer.name) === normalizedLookup,
  );

  if (phoneMatches.length === 1 && exactNameMatches.length === 1) {
    if (phoneMatches[0].id === exactNameMatches[0].id) {
      return {
        status: "matched_phone_and_name",
        match: phoneMatches[0],
        candidates: [phoneMatches[0]],
      };
    }

    return {
      status: "conflict_phone_vs_name",
      match: null,
      candidates: [phoneMatches[0], exactNameMatches[0]],
    };
  }

  if (phoneMatches.length === 1) {
    return {
      status: "matched_phone",
      match: phoneMatches[0],
      candidates: phoneMatches,
    };
  }

  if (phoneMatches.length > 1) {
    return {
      status: "ambiguous_phone",
      match: null,
      candidates: phoneMatches,
    };
  }

  if (exactNameMatches.length === 1) {
    return {
      status: "matched_name",
      match: exactNameMatches[0],
      candidates: exactNameMatches,
    };
  }

  if (exactNameMatches.length > 1) {
    return {
      status: "ambiguous_name",
      match: null,
      candidates: exactNameMatches,
    };
  }

  const fuzzy = customers
    .map((customer) => ({
      customer,
      score: nameSimilarity(lookupName, customer.name),
    }))
    .filter((item) => item.score >= 0.62)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  return {
    status: fuzzy.length > 0 ? "review_fuzzy" : "not_found",
    match: null,
    candidates: fuzzy.map((item) => ({
      ...item.customer,
      similarity: Number(item.score.toFixed(3)),
    })),
  };
}

function compactCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    phone: customer.phone,
    status: customer.status,
    receivableBalanceMinor: customer.receivable_balance_minor,
    receivableBalance: customer.receivable_balance_minor / 100,
    latestReceivableBusinessDate: customer.latest_receivable_business_date ?? null,
    personalAccountId: customer.personal_account_id ?? null,
    personalAccountCode: customer.personal_account_code ?? null,
    personalAccountName: customer.personal_account_name ?? null,
    personalBalanceMinor: customer.personal_balance_minor,
    personalBalance: customer.personal_balance_minor / 100,
    similarity: customer.similarity,
  };
}

async function main() {
  if (!process.argv.includes("--dry-run")) {
    throw new Error(
      "هذه الأداة للقراءة فقط. شغّلها مع --dry-run. لا يوجد وضع Apply في هذا الإصدار.",
    );
  }

  const inputArg = getArg("--input");
  if (!inputArg) {
    throw new Error("حدد ملف Excel: --input /path/to/file.xls");
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`ملف الإدخال غير موجود: ${inputPath}`);
  }

  const personalRules = parsePersonalRules();
  if (personalRules.length === 0) {
    console.warn("⚠️ لم يتم تحديد أي ذمم شخصية عبر --personal.");
  }

  const sourceRows = parseSpreadsheetXml(inputPath);
  const client = new Client({
    connectionString: getDatabaseUrl(),
  });

  await client.connect();

  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");

    const customers = await loadCustomers(client);

    const reviewed = sourceRows.map((row) => {
      const personalRule = personalRuleFor(row.name, personalRules);
      const classification = personalRule ? "personal_receivable" : "customer_receivable";
      const matching = buildCandidates(
        row,
        customers,
        personalRule?.lookupName ?? null,
      );

      const rawPhone = normalizePhone(row.phone);
      const possiblePhoneWithLeadingZero =
        rawPhone.length === 9 && rawPhone.startsWith("5")
          ? `0${rawPhone}`
          : null;

      return {
        ...row,
        classification,
        personalLookupName: personalRule?.lookupName ?? null,
        rawPhone: rawPhone || null,
        possiblePhoneWithLeadingZero,
        matchStatus: matching.status,
        matchedCustomer: compactCustomer(matching.match),
        candidates: matching.candidates.map(compactCustomer),
      };
    });

    await client.query("ROLLBACK");

    const total = reviewed.reduce((sum, row) => sum + row.balance, 0);
    const commercial = reviewed
      .filter((row) => row.classification === "customer_receivable")
      .reduce((sum, row) => sum + row.balance, 0);
    const personal = reviewed
      .filter((row) => row.classification === "personal_receivable")
      .reduce((sum, row) => sum + row.balance, 0);

    const automaticMatches = reviewed.filter((row) =>
      ["matched_phone_and_name", "matched_phone", "matched_name"].includes(row.matchStatus),
    );
    const needsReview = reviewed.filter((row) => !automaticMatches.includes(row));

    console.log("=== Historical Customer Balances — READ ONLY DRY RUN ===");
    console.log(`Input: ${inputPath}`);
    console.log(`Rows: ${reviewed.length}`);
    console.log(`Source total: ${money(total)} ILS`);
    console.log(`Customer receivables: ${money(commercial)} ILS`);
    console.log(`Personal receivables: ${money(personal)} ILS`);
    console.log(`Automatic exact matches: ${automaticMatches.length}`);
    console.log(`Need review: ${needsReview.length}`);
    console.log();

    for (const row of reviewed) {
      const label =
        row.classification === "personal_receivable"
          ? "PERSONAL"
          : "CUSTOMER";
      const matched = row.matchedCustomer;

      console.log(
        `[${label}] #${row.sourceNumber || row.rowNumber} ${row.name} | source=${money(row.balance)} | match=${row.matchStatus}`,
      );

      if (matched) {
        if (row.classification === "personal_receivable") {
          console.log(
            `  → existing SALES customer #${matched.id} ${matched.name} (${matched.code}) | sales receivable=${minorToMoney(matched.receivableBalanceMinor)} ILS | personal receivable=${minorToMoney(matched.personalBalanceMinor)} ILS`,
          );
          console.log(
            "  ℹ this existing sales account is lookup-only; the personal debt must be created as a separate customer/account.",
          );
        } else {
          console.log(
            `  → customer #${matched.id} ${matched.name} (${matched.code}) | current receivable=${minorToMoney(matched.receivableBalanceMinor)} ILS`,
          );
        }
      } else if (row.candidates.length > 0) {
        console.log(
          "  ? candidates: " +
            row.candidates
              .map((candidate) =>
                `#${candidate.id} ${candidate.name}${
                  candidate.similarity !== undefined
                    ? ` [${candidate.similarity}]`
                    : ""
                }`,
              )
              .join(" | "),
        );
      } else {
        console.log("  ? no matching customer found");
      }

      if (row.possiblePhoneWithLeadingZero) {
        console.log(
          `  ⚠ phone may have lost a leading zero in Excel: ${row.rawPhone} → ${row.possiblePhoneWithLeadingZero} (NOT auto-used)`,
        );
      }

      if (
        matched &&
        row.classification === "personal_receivable" &&
        matched.personalAccountId
      ) {
        console.log(
          `  ⚠ personal receivable account already exists on the SALES customer: ${matched.personalAccountCode} | balance=${minorToMoney(matched.personalBalanceMinor)} ILS`,
        );
      }

      if (
        matched &&
        row.classification === "personal_receivable" &&
        matched.receivableBalanceMinor !== 0
      ) {
        console.log(
          `  ℹ existing sales receivable remains untouched: ${minorToMoney(matched.receivableBalanceMinor)} ILS`,
        );
      }

      if (
        matched &&
        row.classification === "customer_receivable" &&
        matched.receivableBalanceMinor !== 0
      ) {
        console.log(
          `  ⚠ current customer receivable is not zero. Reconcile before importing to avoid overlap.`,
        );
      }
    }

    const report = {
      mode: "dry-run-read-only",
      generatedAt: new Date().toISOString(),
      inputFile: path.basename(inputPath),
      summary: {
        rows: reviewed.length,
        sourceTotal: total,
        customerReceivables: commercial,
        personalReceivables: personal,
        automaticExactMatches: automaticMatches.length,
        needsReview: needsReview.length,
      },
      rows: reviewed,
    };

    const outputArg = getArg("--output");
    if (outputArg) {
      const outputPath = path.resolve(process.cwd(), outputArg);
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      console.log();
      console.log(`✅ JSON report written: ${outputPath}`);
    }

    console.log();
    console.log("✅ DRY RUN completed in a READ ONLY transaction.");
    console.log("✅ No customer, finance account, transaction, or balance was changed.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
