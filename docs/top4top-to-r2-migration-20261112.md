# نقل الصور القديمة من Top4top إلى R2 (مرة واحدة)

## النطاق
10 أصناف (230، 231، 232، 233، 234، 235، 237، 238، 239، 241)، و17 صورة مختلفة.
الصنف 242 خارج النطاق لأنه انتقل إلى R2 بالفعل وقت الفحص بتاريخ 2026-11-12.

## مبدأ الأمان
- لا حذف لأي صورة أو ملف.
- لا تعديل تلقائي لقاعدة بيانات الإنتاج.
- `--check` يحمّل الصور ويتأكد من صلاحيتها محليًا فقط.
- `--apply` يرفع الصور إلى `lovely-kids-media-r2` ويقارن SHA-256 لنسخة R2 العلنية مع الأصل قبل اعتماد الرابط الجديد.
- أي صنف لم تنجح **جميع** صوره الخارجية لا يُدرج في SQL المعد للتحديث.
- SQL يستخدم استبدال الروابط القديمة المحددة فقط في `image` و`images` و`color_variants`، ولا يغيّر السعر أو الكمية أو المحاسبة.
- راجع SQL وتحقق من وضع قاعدة البيانات قبل تطبيقه.

## التشغيل من Replit دون تغيير main
```bash
cd /home/runner/workspace
git fetch origin chore/migrate-top4top-images-to-r2-20261112
git show FETCH_HEAD:scripts/migrate-top4top-images-to-r2.mjs > /tmp/lk-top4top-r2.mjs

node /tmp/lk-top4top-r2.mjs --self-test
node /tmp/lk-top4top-r2.mjs --check
node /tmp/lk-top4top-r2.mjs --apply
```

يحتاج Replit تسجيل Wrangler الدخول لنفس حساب Cloudflare الذي يملك bucket.
يستخدم الأمر `npx --yes wrangler@4.152.0 r2 object put ... --remote`.

## المخرجات
- `/tmp/lovely-kids-top4top-r2-migration/migration-report.json`
- `/tmp/lovely-kids-top4top-r2-migration/apply-after-review.sql` بعد `--apply`.

**لا تُنفذ SQL قبل مراجعة التقرير.** شارك نتيجة التقرير في المحادثة لفحص الروابط في Supabase وتطبيق الاستبدال الآمن على الأصناف التي ثبت نقل جميع صورها.

إذا كان رابط Top4top متوقفًا أو فشل التطابق، يبقى الرابط الحالي بدون تغيير ويظهر الصنف في `blocked_product_ids`.
