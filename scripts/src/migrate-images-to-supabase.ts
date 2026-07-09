import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, extname } from "path";
import { Pool } from "pg";

const BUCKET = "product-images";

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dbUrl = process.env.DATABASE_URL;

  if (!supabaseUrl || !supabaseKey || !dbUrl) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL are required");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const pool = new Pool({ connectionString: dbUrl });

  // Ensure bucket exists and is public
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b: { name: string }) => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error) throw new Error(`Failed to create bucket: ${error.message}`);
    console.log(`✅ Created bucket: ${BUCKET}`);
  } else {
    console.log(`✅ Bucket already exists: ${BUCKET}`);
  }

  const uploadsDir = join(process.cwd(), "artifacts", "api-server", "uploads");
  if (!existsSync(uploadsDir)) {
    console.log("No uploads directory found, nothing to migrate.");
    await pool.end();
    return;
  }

  const files = readdirSync(uploadsDir);
  console.log(`Found ${files.length} files to migrate`);

  const extMimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };

  const urlMap: Record<string, string> = {};

  for (const filename of files) {
    const filePath = join(uploadsDir, filename);
    const ext = extname(filename).replace(".", "").toLowerCase();
    const mimeType = extMimeMap[ext] ?? "image/jpeg";

    try {
      const buffer = readFileSync(filePath);

      // Check if already uploaded
      const { data: existing } = await supabase.storage.from(BUCKET).list("", { search: filename });
      if (existing?.some((f: { name: string }) => f.name === filename)) {
        console.log(`  ⏭  Already in Supabase: ${filename}`);
      } else {
        const { error } = await supabase.storage.from(BUCKET).upload(filename, buffer, {
          contentType: mimeType,
          upsert: true,
        });
        if (error) {
          console.error(`  ❌ Failed to upload ${filename}: ${error.message}`);
          continue;
        }
        console.log(`  ✅ Uploaded: ${filename}`);
      }

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
      const oldUrl = `/api/uploads/${filename}`;
      urlMap[oldUrl] = data.publicUrl;
    } catch (err) {
      console.error(`  ❌ Error processing ${filename}:`, err);
    }
  }

  // Update products table — image column and images jsonb array
  console.log("\nUpdating database records...");
  const { rows: products } = await pool.query("SELECT id, image, images FROM products");

  let updatedCount = 0;
  for (const product of products) {
    let changed = false;
    let newImage = product.image as string;
    let newImages = (product.images as string[] | null) ?? [];

    if (newImage && urlMap[newImage]) {
      newImage = urlMap[newImage];
      changed = true;
    }

    newImages = newImages.map((url: string) => {
      if (urlMap[url]) {
        changed = true;
        return urlMap[url];
      }
      return url;
    });

    if (changed) {
      await pool.query("UPDATE products SET image = $1, images = $2 WHERE id = $3", [
        newImage,
        JSON.stringify(newImages),
        product.id,
      ]);
      updatedCount++;
      console.log(`  ✅ Updated product #${product.id as number}`);
    }
  }

  // Update app_settings — logoUrl field
  const { rows: settingsRows } = await pool.query("SELECT data FROM app_settings WHERE id = 1");
  if (settingsRows.length > 0) {
    const data = settingsRows[0].data as Record<string, unknown>;
    let settingsChanged = false;

    if (typeof data.logoUrl === "string" && urlMap[data.logoUrl]) {
      data.logoUrl = urlMap[data.logoUrl];
      settingsChanged = true;
    }

    if (settingsChanged) {
      await pool.query("UPDATE app_settings SET data = $1 WHERE id = 1", [JSON.stringify(data)]);
      console.log("  ✅ Updated app_settings logoUrl");
    }
  }

  console.log(`\n🎉 Done! Migrated ${files.length} files, updated ${updatedCount} products.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
