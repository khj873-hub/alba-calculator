#!/usr/bin/env sh
# Railway 컨테이너 entrypoint
# Litestream을 background로 별도 실행 (replicate -exec 모드 회피)
# node 서버는 foreground — 종료 시 trap으로 litestream도 함께 정리
set -e

DB=/app/server/data/alba.db
LITESTREAM=/app/bin/litestream
mkdir -p "$(dirname "$DB")"

if [ -n "$R2_BUCKET" ] && [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$R2_ENDPOINT" ]; then
  echo "[start] R2 백업 환경변수 감지 — Litestream 모드"
  echo "[start] Litestream version: $($LITESTREAM version)"
  echo "[start] R2 backup 있으면 복원 시도..."
  $LITESTREAM restore -if-replica-exists -config /app/litestream.yml "$DB" 2>&1 || echo "[start] restore 실패 또는 backup 없음 — 기존 로컬 DB 사용"

  echo "[start] Litestream을 background로 실행 (TRACE 로그, stderr 통합)"
  $LITESTREAM replicate -trace stderr -config /app/litestream.yml > /tmp/litestream.log 2>&1 &
  LITESTREAM_PID=$!
  echo "[start] Litestream PID=$LITESTREAM_PID, 초기 로그:"
  sleep 2
  cat /tmp/litestream.log || true
  # 백그라운드 로그를 stdout으로 실시간 tail (Railway 로그에 노출)
  tail -f /tmp/litestream.log &

  trap "echo '[start] SIGTERM 받음 — Litestream 정리'; kill -TERM $LITESTREAM_PID 2>/dev/null; wait $LITESTREAM_PID 2>/dev/null" TERM INT
  echo "[start] node 서버 시작 (foreground)"
  exec node /app/server/dist/index.js
else
  echo "[start] ⚠️  R2 환경변수 미설정 — 백업 없이 서버만 시작"
  exec node /app/server/dist/index.js
fi
