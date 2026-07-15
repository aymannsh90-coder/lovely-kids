import { Router } from "express";
import { randomUUID } from "crypto";
import { supabase, BUCKET, ensureBucket } from "../lib/supabase";
import { requireAdmin } from "../lib/auth";

const router = Router();

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

  try {
    await getBucket();

    const ext = mimeType.includes("png") ? "png" : mimeType.includes("gif") ? "gif" : mimeType.includes("webp") ? "webp" : "jpg";
    const filename = `${randomUUID()}.${ext}`;
    const buffer = Buffer.from(base64, "base64");

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, buffer, {
        contentType: mimeType,
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
