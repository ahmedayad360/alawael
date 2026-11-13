#!/usr/bin/env bash
# رفع نسخة التجربة إلى GitHub Pages
# عدّل المتغيرات الثلاثة ثم: bash publish.sh
set -e
GH_USER="USERNAME"          # اسم المستخدم في GitHub
REPO="alawael"              # اسم المستودع
BRANCH="main"
MSG="${1:-الأوائل — تحديث نسخة التجربة}"

cd "$(dirname "$0")"
if [ ! -d .git ]; then
  git init
  git branch -M "$BRANCH"
  git remote add origin "https://github.com/${GH_USER}/${REPO}.git"
fi
git add -A
git commit -m "$MSG" || echo "لا تغييرات جديدة"
git push -u origin "$BRANCH"
echo "✅ تم الرفع — انتظر دقيقة ثم افتح: https://${GH_USER}.github.io/${REPO}/"
