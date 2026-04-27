#!/usr/bin/env bash
# Idempotent dev-secrets check. Runs before `pnpm dev` and from `setup.sh`.
#
# - Creates `.env` from `.env.example` if missing.
# - Symlinks `packages/db/.env` → `../../.env` so Prisma works from any cwd.
# - Fills JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / ENCRYPTION_KEY_BASE64 if
#   they are empty OR contain a known placeholder. Real values are never
#   overwritten.
#
# Exits 0 on success. Exits 1 only if openssl is missing AND a secret can't
# be filled — in which case the user gets an explicit fix instruction.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

quiet=0
[ "${1:-}" = "--quiet" ] && quiet=1

ok()   { [ $quiet -eq 1 ] || printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }

# 1. Bootstrap .env from .env.example if missing.
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    ok "created .env from .env.example"
  else
    err ".env and .env.example are both missing"
    exit 1
  fi
fi

# 2. Keep packages/db/.env aligned (Prisma reads from cwd).
ln -sf ../../.env packages/db/.env 2>/dev/null || true

# 3. Detect & fill placeholder/empty secrets. Real values are left untouched.
# Empty values are handled separately ([ -z ... ]); list only non-empty placeholders here.
PLACEHOLDERS_RE='^(replace-me-32-byte-hex|replace-me|change-me|todo|TODO)$'

needs_fill() {
  local key="$1"
  local current
  current=$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)
  [ -z "$current" ] && return 0
  echo "$current" | grep -qE "$PLACEHOLDERS_RE" && return 0
  return 1
}

# Portable in-place sed: macOS BSD sed needs '' after -i; GNU sed errors on it.
sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

set_value() {
  local key="$1" value="$2"
  # Use | as delimiter so base64's / doesn't break it.
  sed_inplace "s|^${key}=.*|${key}=${value}|" .env
}

fill_if_needed() {
  local key="$1" generator="$2" min_chars="$3"
  if needs_fill "$key"; then
    if ! command -v openssl >/dev/null 2>&1; then
      err "$key needs a value (≥${min_chars} chars) but openssl is not installed."
      err "Install openssl, or set $key manually in .env."
      exit 1
    fi
    set_value "$key" "$($generator)"
    ok "filled $key"
  fi
}

gen_hex32() { openssl rand -hex 32; }
gen_b64_32() { openssl rand -base64 32; }

fill_if_needed JWT_ACCESS_SECRET     gen_hex32 32
fill_if_needed JWT_REFRESH_SECRET    gen_hex32 32
fill_if_needed ENCRYPTION_KEY_BASE64 gen_b64_32 40
