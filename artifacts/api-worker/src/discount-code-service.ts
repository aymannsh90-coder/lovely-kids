import {
  discountCodesTable,
  type DiscountCode,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { openDb } from "./db";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

export function normalizeDiscountCode(
  value: string,
) {
  return value
    .trim()
    .toUpperCase();
}

function getStoreDate() {
  try {
    const parts =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:
            "Asia/Jerusalem",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        },
      ).formatToParts(
        new Date(),
      );

    const values =
      Object.fromEntries(
        parts.map(
          (part) => [
            part.type,
            part.value,
          ],
        ),
      );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date()
      .toISOString()
      .slice(0, 10);
  }
}

export function discountCodesEnabled(
  settingsData: unknown,
) {
  return (
    (
      settingsData as
        | {
            discountCodesEnabled?: unknown;
          }
        | null
        | undefined
    )?.discountCodesEnabled ===
    true
  );
}

export function isDiscountCodeActiveNow(
  code: Pick<
    DiscountCode,
    | "isActive"
    | "startDate"
    | "endDate"
  >,
) {
  if (!code.isActive) {
    return false;
  }

  const today =
    getStoreDate();

  if (
    code.startDate &&
    today < code.startDate
  ) {
    return false;
  }

  if (
    code.endDate &&
    today > code.endDate
  ) {
    return false;
  }

  return true;
}

export async function findActiveDiscountCode(
  db: Db,
  settingsData: unknown,
  rawCode: string,
) {
  if (
    !discountCodesEnabled(
      settingsData,
    )
  ) {
    return null;
  }

  const normalizedCode =
    normalizeDiscountCode(
      rawCode,
    );

  if (!normalizedCode) {
    return null;
  }

  const rows =
    await db
      .select()
      .from(
        discountCodesTable,
      )
      .where(
        eq(
          discountCodesTable.normalizedCode,
          normalizedCode,
        ),
      )
      .limit(1);

  const code =
    rows[0];

  if (
    !code ||
    !isDiscountCodeActiveNow(
      code,
    )
  ) {
    return null;
  }

  return code;
}
