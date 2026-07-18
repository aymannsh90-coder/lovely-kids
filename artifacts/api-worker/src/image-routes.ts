import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";

type Db = Awaited<
  ReturnType<typeof openDb>
>["db"];

const BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_CHARS =
  Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8;

const MIME_TO_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type AllowedMimeType =
  keyof typeof MIME_TO_EXTENSION;

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });

async function requireAdmin(
  request: Request,
  db: Db,
  env: Env,
) {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  return null;
}

function normalizeMimeType(
  value: string,
): AllowedMimeType | null {
  const normalized = value.trim().toLowerCase();
  const candidate =
    normalized === "image/jpg"
      ? "image/jpeg"
      : normalized;

  return candidate in MIME_TO_EXTENSION
    ? (candidate as AllowedMimeType)
    : null;
}

function decodeBase64Image(
  value: string,
): Buffer | null {
  if (
    !value ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return null;
  }

  const unpadded = value.replace(/=+$/, "");
  const padded = unpadded.padEnd(
    Math.ceil(unpadded.length / 4) * 4,
    "=",
  );

  const buffer = Buffer.from(padded, "base64");

  if (
    buffer.length === 0 ||
    buffer
      .toString("base64")
      .replace(/=+$/, "") !== unpadded
  ) {
    return null;
  }

  return buffer;
}

function matchesImageSignature(
  buffer: Buffer,
  mimeType: AllowedMimeType,
): boolean {
  if (mimeType === "image/jpeg") {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  if (mimeType === "image/png") {
    const signature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    return (
      buffer.length >= signature.length &&
      buffer
        .subarray(0, signature.length)
        .equals(signature)
    );
  }

  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  );
}

async function uploadToSupabase(
  env: Env,
  filename: string,
  buffer: Buffer,
  mimeType: AllowedMimeType,
) {
  const supabaseUrl =
    env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey =
    env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Supabase Storage secrets are missing",
    );
  }

  const uploadUrl =
    `${supabaseUrl}/storage/v1/object/` +
    `${BUCKET}/${encodeURIComponent(filename)}`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": mimeType,
      "x-upsert": "false",
    },
    body: buffer,
  });

  if (!response.ok) {
    const details = await response
      .text()
      .catch(() => "");

    console.error(
      "Supabase Storage upload failed",
      response.status,
      details,
    );

    throw new Error("Supabase Storage upload failed");
  }

  return (
    `${supabaseUrl}/storage/v1/object/public/` +
    `${BUCKET}/${encodeURIComponent(filename)}`
  );
}

async function handleImageUpload(
  request: Request,
  db: Db,
  env: Env,
) {
  const authError = await requireAdmin(
    request,
    db,
    env,
  );

  if (authError) return authError;

  const body = await request
    .json()
    .catch(() => null) as {
      base64?: unknown;
      mimeType?: unknown;
    } | null;

  if (
    !body ||
    typeof body.base64 !== "string" ||
    typeof body.mimeType !== "string"
  ) {
    return json(
      { error: "base64 و mimeType مطلوبان" },
      400,
    );
  }

  const normalizedMimeType =
    normalizeMimeType(body.mimeType);

  if (!normalizedMimeType) {
    return json(
      {
        error:
          "نوع الصورة غير مدعوم. استخدم JPEG أو PNG أو WebP",
      },
      415,
    );
  }

  if (body.base64.length > MAX_BASE64_CHARS) {
    return json(
      { error: "حجم الصورة يتجاوز 5MB" },
      413,
    );
  }

  const buffer = decodeBase64Image(body.base64);

  if (!buffer) {
    return json(
      { error: "بيانات الصورة غير صالحة" },
      400,
    );
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    return json(
      { error: "حجم الصورة يتجاوز 5MB" },
      413,
    );
  }

  if (
    !matchesImageSignature(
      buffer,
      normalizedMimeType,
    )
  ) {
    return json(
      {
        error:
          "محتوى الصورة لا يطابق نوع الملف المرسل",
      },
      400,
    );
  }

  try {
    const ext =
      MIME_TO_EXTENSION[normalizedMimeType];

    const filename =
      `${randomUUID()}.${ext}`;

    const url = await uploadToSupabase(
      env,
      filename,
      buffer,
      normalizedMimeType,
    );

    return json({
      url,
      objectPath: filename,
    });
  } catch (error) {
    console.error("Image upload failed", error);

    return json(
      { error: "فشل رفع الصورة" },
      500,
    );
  }
}

export async function handleImageRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "POST" &&
    path === "/api/images/upload"
  ) {
    return handleImageUpload(request, db, env);
  }

  return null;
}
