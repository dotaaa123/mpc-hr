#!/bin/sh
# Documents is on iCloud Drive. codesign rejects those files with
# "resource fork, Finder information, or similar detritus not allowed",
# and the metadata cannot be stripped in place. Copy the bundle outside
# iCloud, sign it there, then copy the signed bundle back.
set -e

APP="${TARGET_BUILD_DIR}/${FULL_PRODUCT_NAME}"
if [ ! -d "$APP" ]; then
  echo "error: app bundle not found at ${APP}" >&2
  exit 1
fi

SIGN_ID="${EXPANDED_CODE_SIGN_IDENTITY:--}"
if [ -z "$SIGN_ID" ]; then
  SIGN_ID="-"
fi

ENT_SRC="${CODE_SIGN_ENTITLEMENTS:-}"
if [ -n "$ENT_SRC" ] && [ ! -f "$ENT_SRC" ]; then
  ENT_SRC="${SRCROOT}/${CODE_SIGN_ENTITLEMENTS}"
fi

WORK="${TMPDIR:-/tmp}/mpc_hr_desktop.sign.$$"
rm -rf "$WORK"
mkdir -p "$WORK"
TMP_APP="${WORK}/${FULL_PRODUCT_NAME}"
ENT_FILE="${WORK}/entitlements.plist"

ditto --norsrc "$APP" "$TMP_APP"
/usr/bin/xattr -cr "$TMP_APP" || true

if [ -n "$ENT_SRC" ] && [ -f "$ENT_SRC" ]; then
  cp "$ENT_SRC" "$ENT_FILE"
else
  /usr/bin/plutil -create xml1 "$ENT_FILE"
fi

if [ "${CONFIGURATION}" != "Release" ]; then
  /usr/libexec/PlistBuddy -c "Delete :com.apple.security.get-task-allow" "$ENT_FILE" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add :com.apple.security.get-task-allow bool true" "$ENT_FILE"
fi

/usr/bin/codesign --force --deep --sign "$SIGN_ID" \
  --entitlements "$ENT_FILE" \
  --timestamp=none \
  --generate-entitlement-der \
  "$TMP_APP"

rm -rf "$APP"
ditto --norsrc "$TMP_APP" "$APP"
rm -rf "$WORK"

/usr/bin/codesign --verify "$APP"
