import { Router } from "express";
import { randomUUID } from "crypto";
import { supabase, BUCKET, ensureBucket } from "../lib/supabase";
import { requireAdmin } from "../lib/auth";

const router = Router();

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8;

const MIME_TO_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type AllowedMimeType = keyof typeof MIME_TO_EXTENSION;

function normalizeMimeType(value: string): AllowedMimeType | null {
  const normalized = value.trim().toLowerCase();
  const candidate =
    normalized === "image/jpg" ? "image/jpeg" : normalized;

  return candidate in MIME_TO_EXTENSION
    ? (candidate as AllowedMimeType)
    : null;
}

function decodeBase64Image(value: string): Buffer | null {
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
    buffer.toString("base64").replace(/=+$/, "") !== unpadded
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
      buffer.subarray(0, signature.length).equals(signature)
    );
  }

  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  );
}
let bucketReady = false;

async function getBucket() {
  if (!bucketReady) {
    await ensureBucket();
    bucketReady = true;
  }
}

// POST /api/images/upload
// Body: { base64: string, mimeType: string }
// Returns: { url: string, objectPath: string }
router.post("/images/upload", requireAdmin, async (req, res) => {
  const { base64, mimeType } = req.body as { base64?: string; mimeType?: string };

  if (!base64 || !mimeType) {
    res.status(400).json({ error: "base64 و mimeType مطلوبان" });
    return;
  }

  const normalizedMimeType = normalizeMimeType(mimeType);

  if (!normalizedMimeType) {
    res.status(415).json({
      error: "نوع الصورة غير مدعوم. استخدم JPEG أو PNG أو WebP",
    });
    return;
  }

  if (base64.length > MAX_BASE64_CHARS) {
    res.status(413).json({ error: "حجم الصورة يتجاوز 5MB" });
    return;
  }

  const buffer = decodeBase64Image(base64);

  if (!buffer) {
    res.status(400).json({ error: "بيانات الصورة غير صالحة" });
    return;
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    res.status(413).json({ error: "حجم الصورة يتجاوز 5MB" });
    return;
  }

  if (!matchesImageSignature(buffer, normalizedMimeType)) {
    res.status(400).json({
      error: "محتوى الصورة لا يطابق نوع الملف المرسل",
    });
    return;
  }

  try {
    await getBucket();

    const ext = MIME_TO_EXTENSION[normalizedMimeType];
    const filename = `${randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, buffer, {
        contentType: normalizedMimeType,
        upsert: false,
      });

    if (error) {
      req.log?.error({ err: error }, "supabase upload failed");
      res.status(500).json({ error: "فشل رفع الصورة" });
      return;
    }

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(filename);
    const url = publicData.publicUrl;

    res.json({ url, objectPath: filename });
  } catch (err) {
    req.log?.error({ err }, "image upload failed");
    res.status(500).json({ error: "فشل رفع الصورة" });
  }
});

// GET /api/uploads/:filename — legacy redirect to Supabase public URL
router.get("/uploads/:filename", (req, res) => {
  const { filename } = req.params;

  if (!filename || filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "اسم ملف غير صالح" });
    return;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  res.redirect(301, data.publicUrl);
});

export default router;
