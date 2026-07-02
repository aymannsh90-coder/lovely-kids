import { Router } from "express";
import { randomUUID } from "crypto";
import { objectStorageClient } from "../lib/objectStorage";

const router = Router();

function getBucketAndDir() {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  if (!bucketId) throw new Error("Object storage not configured");
  return { bucketId, privateDir };
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
    const { bucketId, privateDir } = getBucketAndDir();
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const objectId = randomUUID();
    const objectName = privateDir
      ? `${privateDir.replace(/^gs:\/\/[^/]+\//, "").replace(/\/$/, "")}/images/${objectId}.${ext}`
      : `images/${objectId}.${ext}`;

    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(objectName);

    const buffer = Buffer.from(base64, "base64");

    await file.save(buffer, {
      contentType: mimeType,
      resumable: false,
    });

    const objectPath = `/objects/images/${objectId}.${ext}`;

    res.json({ objectPath, url: `/api/storage/objects/images/${objectId}.${ext}` });
  } catch (err) {
    req.log?.error({ err }, "image upload failed");
    res.status(500).json({ error: "فشل رفع الصورة" });
  }
});

// GET /api/storage/objects/* — serve uploaded images
router.get("/storage/objects/*path", async (req, res) => {
  try {
    const { bucketId, privateDir } = getBucketAndDir();
    const rawPath = (req.params as Record<string, string>)["path"] ?? "";

    const objectName = privateDir
      ? `${privateDir.replace(/^gs:\/\/[^/]+\//, "").replace(/\/$/, "")}/${rawPath}`
      : rawPath;

    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();

    if (!exists) {
      res.status(404).json({ error: "الصورة غير موجودة" });
      return;
    }

    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string) || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000");
    file.createReadStream().pipe(res);
  } catch (err) {
    req.log?.error({ err }, "image serve failed");
    res.status(500).json({ error: "فشل تحميل الصورة" });
  }
});

export default router;
