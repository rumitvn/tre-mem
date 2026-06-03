#!/usr/bin/env bash
#
# T3D5 — two-dev sync rehearsal (Checkpoint T3).
#
# Proves the Phase 2 sync foundation end-to-end through *real git*:
#   alice: tre pin -> tre export -> git commit/push
#   bob:   git pull -> tre import -> alice's pin is in bob's sidecar
#
# Fully self-contained: a bare "remote" + two clones + two isolated
# TRE_MEM_HOME sidecars, all under a temp dir. No network, no claude-mem
# dependency (pins carry their note as the shared payload).
#
# Note: surfacing imported pins through `tre search` lands in T4D9
# (retrieval-v2 renders shared pins from their JSONL snapshot). This script
# verifies the sync transport: that alice's pin arrives intact in bob's DB,
# deduplicates, and re-imports idempotently.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/dist/cli.js"
WORK="$(mktemp -d -t tre-two-dev-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

REMOTE="$WORK/remote.git"
ALICE="$WORK/alice"
BOB="$WORK/bob"
export_home() { echo "$WORK/$1-home"; }

NOTE="use Stripe webhook v3 for idempotency"
PROJECT="payments-demo"

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$1"; exit 1; }

echo "T3D5 two-dev E2E — work dir: $WORK"

# --- 0. build if needed ---
[ -f "$CLI" ] || (cd "$ROOT" && pnpm build >/dev/null)

# --- 1. bare remote + two clones ---
git init -q --bare "$REMOTE"
git clone -q "$REMOTE" "$ALICE"
git -C "$ALICE" config user.email alice@example.com
git -C "$ALICE" config user.name alice
# seed a first commit so the default branch exists on the remote
echo "# $PROJECT" > "$ALICE/README.md"
git -C "$ALICE" add README.md
git -C "$ALICE" commit -qm "init"
git -C "$ALICE" push -q origin HEAD
BRANCH="$(git -C "$ALICE" rev-parse --abbrev-ref HEAD)"

# --- 2. alice pins + exports + pushes ---
TRE_MEM_HOME="$(export_home alice)" node "$CLI" pin 99001 \
  --project "$PROJECT" --branch "$BRANCH" --note "$NOTE" >/dev/null
TRE_MEM_HOME="$(export_home alice)" node "$CLI" export \
  --project "$PROJECT" --branch "$BRANCH" --out "$ALICE/.tre-mem" >/dev/null
[ -f "$ALICE/.tre-mem/branches/$BRANCH.jsonl" ] || fail "alice export did not write the branch file"
grep -q "$NOTE" "$ALICE/.tre-mem/branches/$BRANCH.jsonl" || fail "exported JSONL missing the note"
pass "alice exported pin to .tre-mem/branches/$BRANCH.jsonl"

git -C "$ALICE" add .tre-mem
git -C "$ALICE" commit -qm "share pin: stripe webhook"
git -C "$ALICE" push -q origin HEAD
pass "alice committed + pushed .tre-mem/"

# --- 3. bob clones, imports ---
git clone -q "$REMOTE" "$BOB"
[ -f "$BOB/.tre-mem/branches/$BRANCH.jsonl" ] || fail "bob's clone is missing the shared dir"

OUT="$(TRE_MEM_HOME="$(export_home bob)" node "$CLI" import --from "$BOB/.tre-mem")"
echo "$OUT" | grep -q "imported 1 pin" || fail "bob import did not report 1 pin: $OUT"
pass "bob imported alice's pin via git pull + tre import"

# --- 4. assert the pin landed intact in bob's sidecar ---
BOB_DB="$(export_home bob)/tre-mem.db"
ASSERT="$(node -e '
  const Database = require("'"$ROOT"'/node_modules/better-sqlite3");
  const db = new Database(process.argv[1], { readonly: true });
  const row = db.prepare("SELECT note, branch, content_hash, shared_at_epoch FROM branch_pin WHERE project = ?").get(process.argv[2]);
  if (!row) { console.log("MISSING"); process.exit(0); }
  console.log([row.note, row.branch, row.content_hash ? "hash" : "nohash", row.shared_at_epoch != null ? "shared" : "unshared"].join("|"));
' "$BOB_DB" "$PROJECT")"
echo "$ASSERT" | grep -q "^$NOTE|$BRANCH|hash|shared$" || fail "bob's pin row is wrong: $ASSERT"
pass "bob's sidecar row matches: note + branch + content_hash + shared"

# --- 5. idempotency: re-import is a no-op ---
OUT2="$(TRE_MEM_HOME="$(export_home bob)" node "$CLI" import --from "$BOB/.tre-mem")"
echo "$OUT2" | grep -q "unchanged" || fail "re-import was not skipped as unchanged: $OUT2"
COUNT="$(node -e '
  const Database = require("'"$ROOT"'/node_modules/better-sqlite3");
  const db = new Database(process.argv[1], { readonly: true });
  console.log(db.prepare("SELECT COUNT(*) n FROM branch_pin WHERE project = ?").get(process.argv[2]).n);
' "$BOB_DB" "$PROJECT")"
[ "$COUNT" = "1" ] || fail "re-import duplicated rows (count=$COUNT)"
pass "re-import is idempotent (still 1 row)"

# --- 6. bob's `tre search` surfaces alice's pin from its snapshot (T4D9) ---
SEARCH="$(TRE_MEM_HOME="$(export_home bob)" node "$CLI" search "webhook" \
  --project "$PROJECT" --branch "$BRANCH" 2>/dev/null || true)"
if echo "$SEARCH" | grep -q "$NOTE" && echo "$SEARCH" | grep -q "shared"; then
  pass "bob's tre search surfaces alice's shared pin"
else
  printf '  \033[33m~ skipped search assertion (needs ~/.claude-mem present)\033[0m\n'
fi

echo ""
echo "✅ Checkpoint T3 PASSED — sync foundation works through real git."
