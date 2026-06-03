#!/usr/bin/env sh
# Railway 컨테이너 entrypoint
# - R2 환경변수 있으면 Litestream으로 백업/복원 + 서버 시작
# - 환경변수 없으면 graceful fallback (서버만 시작)
set -e

DB=/app/server/data/alba.db
LITESTREAM=/app/bin/litestream
mkdir -p "$(dirname "$DB")"

# Litestream 디버그 로그 (sync iteration까지 출력)
export LITESTREAM_LOG_LEVEL=debug

if [ -n "$R2_BUCKET" ] && [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$R2_ENDPOINT" ]; then
  echo "[start] R2 백업 환경변수 감지 — Litestream 모드"
  echo "[start] Litestream version: $($LITESTREAM version)"
  echo "[start] R2 backup 있으면 복원 시도..."
  $LITESTREAM restore -if-replica-exists -config /app/litestream.yml "$DB" 2>&1 || echo "[start] restore 실패 또는 backup 없음 — 기존 로컬 DB 사용"
  echo "[start] Litestream replicate + node 서버 시작 (stderr 통합)"
  exec $LITESTREAM replicate -config /app/litestream.yml -exec "node /app/server/dist/index.js" 2>&1
else
  echo "[start] ⚠️  R2 환경변수 미설정 — 백업 없이 서버만 시작"
  exec node /app/server/dist/index.js
fi
