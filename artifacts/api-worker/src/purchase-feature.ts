import type { Env } from "./db";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

export function isPurchaseApiEnabled(env: Env) {
  return env.POS_PURCHASE_API_ENABLED === "true";
}

export function isPurchaseWriteEnabled(env: Env) {
  return (
    isPurchaseApiEnabled(env) &&
    env.POS_PURCHASE_WRITES_ENABLED === "true"
  );
}

export function purchaseFeatureDisabledResponse() {
  return json(
    {
      error: "وحدة الموردين والمشتريات غير مفعلة",
    },
    503,
  );
}

export function purchaseWritesDisabledResponse() {
  return json(
    {
      error: "حفظ الموردين والمشتريات غير مفعل",
    },
    503,
  );
}
