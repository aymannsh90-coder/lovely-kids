import { randomUUID } from "node:crypto";
import { getCurrentUser } from "./auth";
import type { Env, openDb } from "./db";
import { rewriteMediaUrlsForPublic } from "./media-url";

type Db = Awaited<ReturnType<typeof openDb>>["db"];

const BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

const MIME_TO_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
} as const;

type AllowedMimeType = keyof typeof MIME_TO_EXTENSION;

const json = (data: unknown, status = 200) =>
  Response.json(rewriteMediaUrlsForPublic(data), {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });

async function requireAdmin(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const user = await getCurrentUser(db, request, env);

  if (!user) {
    return json({ error: "يجب تسجيل الدخول" }, 401);
  }

  if (!user.isAdmin) {
    return json({ error: "غير مصرح" }, 403);
  }

  return null;
}

function matchesSignature(
  bytes: Uint8Array,
  mimeType: AllowedMimeType,
): boolean {
  if (mimeType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }

  if (mimeType === "image/png") {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return sig.every((value, index) => bytes[index] === value);
  }

  if (mimeType === "image/webp") {
    return (
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  }

  // MP4 files contain an ftyp box near the beginning.
  return (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp"
  );
}

async function uploadObject(
  env: Env,
  filename: string,
  buffer: ArrayBuffer,
  mimeType: AllowedMimeType,
): Promise<string> {
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase Storage secrets are missing");
  }

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${BUCKET}/${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": mimeType,
        "x-upsert": "false",
      },
      body: buffer,
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("HERO_MEDIA_UPLOAD_FAILED", response.status, details);
    throw new Error("Supabase Storage upload failed");
  }

  return (
    `${supabaseUrl}/storage/v1/object/public/` +
    `${BUCKET}/${encodeURIComponent(filename)}`
  );
}

async function deleteObject(
  env: Env,
  filename: string,
): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase Storage secrets are missing");
  }

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${BUCKET}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: [filename] }),
    },
  );

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("HERO_MEDIA_DELETE_FAILED", response.status, details);
    throw new Error("Supabase Storage delete failed");
  }
}

export async function handleHeroMediaRequest(
  request: Request,
  db: Db,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (
    request.method === "POST" &&
    path === "/api/hero-media/upload"
  ) {
    const authError = await requireAdmin(request, db, env);
    if (authError) return authError;

    const form = await request.formData().catch(() => null);
    const entry = form?.get("file");

    if (!entry || typeof entry === "string") {
      return json({ error: "الملف مطلوب" }, 400);
    }

    const mimeType = entry.type.toLowerCase() as AllowedMimeType;

    if (!(mimeType in MIME_TO_EXTENSION)) {
      return json(
        { error: "يدعم Hero صور JPEG/PNG/WebP أو فيديو MP4 فقط" },
        415,
      );
    }

    const isVideo = mimeType === "video/mp4";
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

    if (entry.size > maxBytes) {
      return json(
        {
          error: isVideo
            ? "حجم الفيديو يجب ألا يتجاوز 8MB"
            : "حجم الصورة يجب ألا يتجاوز 5MB",
        },
        413,
      );
    }

    const buffer = await entry.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (!matchesSignature(bytes, mimeType)) {
      return json({ error: "محتوى الملف لا يطابق نوعه" }, 400);
    }

    try {
      const ext = MIME_TO_EXTENSION[mimeType];
      const filename = `hero-${randomUUID()}.${ext}`;

      const url = await uploadObject(
        env,
        filename,
        buffer,
        mimeType,
      );

      return json({
        url,
        objectPath: filename,
        type: isVideo ? "video" : "image",
      });
    } catch (error) {
      console.error("HERO_MEDIA_UPLOAD_FAILED", error);
      return json({ error: "فشل رفع ملف Hero" }, 500);
    }
  }

  const deleteMatch = path.match(/^\/api\/hero-media\/([^/]+)$/);

  if (request.method === "DELETE" && deleteMatch) {
    const authError = await requireAdmin(request, db, env);
    if (authError) return authError;

    let filename: string;

    try {
      filename = decodeURIComponent(deleteMatch[1]);
    } catch {
      return json({ error: "اسم الملف غير صالح" }, 400);
    }

    if (
      !filename.startsWith("hero-") ||
      filename.includes("/") ||
      filename.includes("..")
    ) {
      return json({ error: "ملف Hero غير صالح" }, 400);
    }

    try {
      await deleteObject(env, filename);
      return json({ ok: true });
    } catch (error) {
      console.error("HERO_MEDIA_DELETE_FAILED", error);
      return json({ error: "فشل حذف ملف Hero" }, 500);
    }
  }

  return null;
}
