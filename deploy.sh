#!/bin/bash

echo "📦 Adding files..."
git add .

echo "✍️ اكتب وصف التعديل:"
read msg

if [ -z "$msg" ]; then
  msg="Update project"
fi

echo "✅ Creating commit..."
git commit -m "$msg"

echo "🚀 Pushing to GitHub..."
git push origin main

echo "🎉 Done! Vercel سيبدأ النشر تلقائيًا."
