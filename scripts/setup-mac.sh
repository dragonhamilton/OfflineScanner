#!/usr/bin/env bash
# Installs everything OfflineScanner needs on a Mac, then installs its packages
# and creates its databases. Safe to run again: each step skips what's done.
#
#   bash scripts/setup-mac.sh                 # standard setup (Tesseract OCR)
#   bash scripts/setup-mac.sh --with-rapidocr # also uv + Python 3.12 for RapidOCR
#   bash scripts/setup-mac.sh --skip-browser  # don't download Playwright's Chromium
#
# This is for a Mac with internet. The offline Ubuntu machine has its own
# steps in the README; don't run this there.
set -euo pipefail

WITH_RAPIDOCR=0
SKIP_BROWSER=0
for arg in "$@"; do
  case "$arg" in
    --with-rapidocr) WITH_RAPIDOCR=1 ;;
    --skip-browser) SKIP_BROWSER=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

PG_FORMULA=postgresql@16
DB_ROLE=scanner
DB_PASSWORD=scanner
DATABASES=(offline_scanner offline_scanner_e2e)

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
info() { printf '    %s\n' "$1"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "this script is for macOS. On Ubuntu, follow the README."

# --- Homebrew -----------------------------------------------------------------
step "Homebrew"
if ! command -v brew >/dev/null; then
  die "Homebrew isn't installed. Install it from https://brew.sh, then run this script again."
fi
info "$(brew --version | head -1)"

brew_install() {
  if brew list --versions "$1" >/dev/null 2>&1; then
    info "$1 already installed"
  else
    info "installing $1"
    brew install "$1"
  fi
}

# --- Node -----------------------------------------------------------------------
step "Node.js (22.21 or newer)"
node_ok() {
  command -v node >/dev/null || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=21)?0:1)'
}
if node_ok; then
  info "node $(node -v) at $(command -v node)"
else
  brew_install node@22
  export PATH="$(brew --prefix node@22)/bin:$PATH"
  node_ok || die "node@22 is installed but not on PATH. Add $(brew --prefix node@22)/bin to PATH and rerun."
  info "node $(node -v). Add this to ~/.zshrc so new terminals find it:"
  info "  export PATH=\"$(brew --prefix node@22)/bin:\$PATH\""
fi

# --- pnpm -----------------------------------------------------------------------
step "pnpm (10.16 or newer)"
pnpm_ok() {
  command -v pnpm >/dev/null || return 1
  local v; v=$(pnpm -v); local major=${v%%.*} rest=${v#*.}; local minor=${rest%%.*}
  [ "$major" -gt 10 ] || { [ "$major" -eq 10 ] && [ "$minor" -ge 16 ]; }
}
if pnpm_ok; then
  info "pnpm $(pnpm -v)"
else
  if command -v pnpm >/dev/null; then
    info "pnpm $(pnpm -v) is too old"
    brew list --versions pnpm >/dev/null 2>&1 && brew upgrade pnpm || brew install pnpm
  else
    brew_install pnpm
  fi
  hash -r
  pnpm_ok || die "pnpm 10.16+ still not found on PATH (found: $(command -v pnpm || echo none))."
  info "pnpm $(pnpm -v)"
fi

# --- PostgreSQL 16 --------------------------------------------------------------
step "PostgreSQL 16"
brew_install "$PG_FORMULA"
PG_BIN="$(brew --prefix "$PG_FORMULA")/bin"   # keg-only: use its tools directly

pg_ready() { "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5432 -q; }
port_owner() { lsof -nP -iTCP:5432 -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}'; }

if pg_ready; then
  server_version=$("$PG_BIN/psql" -h 127.0.0.1 -d postgres -Atc 'show server_version_num' 2>/dev/null || true)
  if [ -n "$server_version" ] && [ "${server_version:0:2}" != "16" ]; then
    die "another PostgreSQL ($server_version) is already using port 5432. Stop it (e.g. brew services stop postgresql@14) and rerun."
  fi
  info "a server is already running on 127.0.0.1:5432"
else
  owner=$(port_owner)
  [ -z "$owner" ] || die "port 5432 is taken by $owner. Stop it and rerun."
  for other in $(brew services list | awk '/^postgresql/ && $2=="started" {print $1}'); do
    [ "$other" = "$PG_FORMULA" ] || die "$other is set to start and would clash on port 5432. Run: brew services stop $other"
  done
  info "starting $PG_FORMULA (it will also start at login)"
  brew services start "$PG_FORMULA" >/dev/null
  for _ in $(seq 1 30); do pg_ready && break; sleep 1; done
  pg_ready || die "PostgreSQL didn't start. Check: brew services info $PG_FORMULA"
fi

# Homebrew's cluster makes the current macOS user a superuser.
psql_admin() { "$PG_BIN/psql" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -Atq "$@"; }
psql_admin -c 'select 1' >/dev/null 2>&1 \
  || die "can't connect to PostgreSQL as $(whoami). If this server wasn't set up by Homebrew, create the role and databases by hand (see README)."

if [ "$(psql_admin -c "select 1 from pg_roles where rolname='$DB_ROLE'")" = 1 ]; then
  info "role $DB_ROLE exists"
else
  psql_admin -c "create role $DB_ROLE login password '$DB_PASSWORD'"
  info "created role $DB_ROLE"
fi
for db in "${DATABASES[@]}"; do
  if [ "$(psql_admin -c "select 1 from pg_database where datname='$db'")" = 1 ]; then
    info "database $db exists"
  else
    psql_admin -c "create database $db owner $DB_ROLE"
    info "created database $db"
  fi
done

# --- .env -----------------------------------------------------------------------
step ".env"
if [ -f .env ]; then
  info ".env already exists; left as it is"
else
  sed 's/^# PostgreSQL 16 (start it with: .*)$/# PostgreSQL 16 (on a Mac: brew services start postgresql@16)/' .env.example > .env
  info "created .env from .env.example"
fi

# --- Node packages --------------------------------------------------------------
step "Node packages"
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile
else
  # No lockfile yet: it has to be made on the offline Ubuntu machine against its
  # mirror. Install without writing one so a Mac-made lockfile can't be committed.
  info "no pnpm-lock.yaml yet; installing without writing one"
  pnpm install --config.lockfile=false
fi

# --- Playwright browser ---------------------------------------------------------
step "Browser for the end-to-end tests"
if [ "$SKIP_BROWSER" = 1 ]; then
  info "skipped. Run the tests with your installed Chrome: PLAYWRIGHT_CHANNEL=chrome pnpm e2e"
else
  # .env sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD for the offline machine; it's
  # fine to download here, so clear it for this one command.
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= pnpm exec playwright install chromium
fi

# --- RapidOCR (optional) --------------------------------------------------------
if [ "$WITH_RAPIDOCR" = 1 ]; then
  step "RapidOCR (uv + Python 3.12)"
  brew_install uv
  brew_install python@3.12
  (cd tools/rapidocr && uv sync --python "$(brew --prefix python@3.12)/bin/python3.12")
  info "set OCR_ENGINE=rapidocr in .env to use it"
  info "don't commit tools/rapidocr/uv.lock from this Mac: it points at public PyPI."
  info "make that lockfile on the offline machine, like pnpm-lock.yaml."
fi

# --- Check ----------------------------------------------------------------------
step "Check"
if "$PG_BIN/psql" "postgres://$DB_ROLE:$DB_PASSWORD@127.0.0.1:5432/${DATABASES[0]}" -Atc 'select 1' >/dev/null 2>&1; then
  info "app can log in to ${DATABASES[0]}"
else
  die "the app can't log in to ${DATABASES[0]} as $DB_ROLE"
fi
(cd apps/server && node -e "import('sharp').then(()=>process.exit(0),()=>process.exit(1))") \
  && info "sharp loads" || die "sharp doesn't load; try: pnpm install --force"

cat <<'EOF'

Done. Start OfflineScanner with:

  pnpm dev        then open http://127.0.0.1:5173

Tests:  pnpm test   ·   pnpm e2e
EOF
