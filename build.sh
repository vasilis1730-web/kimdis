#!/usr/bin/env bash
#
# Συγχρονίζει τον κοινό κώδικα από src/ προς τους δύο καταναλωτές του και
# συσκευάζει την επέκταση.
#
#   ./build.sh          συγχρονισμός
#   ./build.sh --check  έλεγχος συγχρονισμού (για CI· δεν γράφει τίποτα)
#   ./build.sh --zip    συγχρονισμός + παραγωγή του .zip της επέκτασης
#
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' extension/manifest.json | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"

# αρχείο-πηγή -> προορισμοί
SHARED=(
  "khmdis-core.js"
  "khmdis-ui.js"
  "khmdis-ui.css"
  "vendor/jszip.min.js"
)
TARGETS=("assets" "extension/assets")

MODE="${1:-sync}"
fail=0

for file in "${SHARED[@]}"; do
  for target in "${TARGETS[@]}"; do
    dest="$target/$file"
    mkdir -p "$(dirname "$dest")"
    if [ "$MODE" = "--check" ]; then
      if ! cmp -s "src/$file" "$dest"; then
        echo "✗ εκτός συγχρονισμού: $dest"
        fail=1
      fi
    else
      cp "src/$file" "$dest"
    fi
  done
done

if [ "$MODE" = "--check" ]; then
  [ "$fail" -eq 0 ] && echo "✅ Όλα τα κοινά αρχεία είναι συγχρονισμένα." || {
    echo ""
    echo "Τρέξε ./build.sh για να τα συγχρονίσεις."
    exit 1
  }
  exit 0
fi

echo "✅ Συγχρονίστηκαν ${#SHARED[@]} κοινά αρχεία σε ${#TARGETS[@]} προορισμούς."

# Έλεγχος σύνταξης — καλύτερα να σκάσει εδώ παρά στον browser
for js in src/khmdis-core.js src/khmdis-ui.js sw.js \
         worker/proxy-core.js worker/worker.js \
         functions/proxy/index.js functions/proxy/health.js \
         extension/background.js extension/popup.js extension/app.js; do
  node --check "$js" >/dev/null 2>&1 || { echo "✗ συντακτικό σφάλμα: $js"; node --check "$js"; exit 1; }
done
echo "✅ Έλεγχος σύνταξης JavaScript: OK"

if [ "$MODE" = "--zip" ]; then
  mkdir -p dist
  out="dist/kimdis-extension-v${VERSION}.zip"
  rm -f "$out"
  (cd extension && zip -qr "../$out" . -x '.*' -x '__MACOSX/*')
  echo "✅ Συσκευάστηκε: $out ($(du -h "$out" | cut -f1))"
  echo ""
  echo "Εγκατάσταση: chrome://extensions → Λειτουργία προγραμματιστή →"
  echo "«Φόρτωση χωρίς συμπίεση» → επίλεξε τον φάκελο extension/"
fi
