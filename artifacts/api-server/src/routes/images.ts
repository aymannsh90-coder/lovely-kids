import { Router } from "express";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { existsSync, createReadStream, statSync } from "fs";
import { join } from "path";

const router = Router();

const UPLOADS_DIR = join(process.cwd(), "uploads");

async function ensureUploadsDir() {
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }
}

// POST /api/images/upload
// Body: { base64: string, mimeType: string }
// Returns: { url: string, objectPath: string }
router.post("/images/upload", async (req, res) => {
  const { base64, mimeType } = req.body as { base64?: string; mimeType?: string };

  if (!base64 || !mimeType) {
    res.status(400).json({ error: "base64 و mimeType مطلوبان" });
    return;
  }

  try {
    await ensureUploadsDir();

    const ext = mimeType.includes("png") ? "png" : mimeType.includes("gif") ? "gif" : mimeType.includes("webp") ? "webp" : "jpg";
    const filename = `${randomUUID()}.${ext}`;
    const filePath = join(UPLOADS_DIR, filename);

    const buffer = Buffer.from(base64, "base64");
    await writeFile(filePath, buffer);

    const url = `/api/uploads/${filename}`;
    res.json({ url, objectPath: url });
  } catch (err) {
    req.log?.error({ err }, "image upload failed");
    res.status(500).json({ error: "فشل رفع الصورة" });
  }
});

// GET /api/uploads/:filename — serve uploaded images
router.get("/uploads/:filename", (req, res) => {
  const { filename } = req.params;

  if (!filename || filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "اسم ملف غير صالح" });
    return;
  }

  const filePath = join(UPLOADS_DIR, filename);

  if (!existsSync(filePath)) {
    res.status(404).json({ error: "الصورة غير موجودة" });
    return;
  }

  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  const contentType = ext ? (mimeTypes[ext] ?? "image/jpeg") : "image/jpeg";

  const stat = statSync(filePath);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Cache-Control", "public, max-age=31536000");
  createReadStream(filePath).pipe(res);
});

export default router;
