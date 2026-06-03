# alba-calculator 백업·복원 운영 매뉴얼

> 운영자(jinusoft19@gmail.com) 전용. 일반 사장님은 본 문서 볼 필요 없음 — 자동으로 처리됨.
> 최종 업데이트: 2026-06-03

## 아키텍처

```
Railway 컨테이너
  ├─ node 서버 (포트 3002)
  └─ Litestream 사이드카
       ↓ 실시간 WAL 스트리밍 (10초 간격)
Cloudflare R2 (alba-calculator-backup 버킷)
  └─ alba.db (스냅샷 + WAL 증분)
```

- DB 파일: `/app/server/data/alba.db` (컨테이너 내부)
- 백업 저장소: Cloudflare R2 `alba-calculator-backup` 버킷
- 스트리밍 도구: [Litestream](https://litestream.io) (단일 바이너리, nixpkgs로 설치)
- 시작 스크립트: `start.sh` — 환경변수 있으면 Litestream 모드, 없으면 fallback

## 환경변수 (Railway)

| 변수 | 예시 |
|---|---|
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | `alba-calculator-backup` |
| `R2_ACCESS_KEY_ID` | (Cloudflare R2 → API 토큰에서 발급) |
| `R2_SECRET_ACCESS_KEY` | (한 번만 표시되므로 즉시 저장) |

네 개 중 하나라도 없으면 `start.sh`가 Litestream 없이 서버만 시작 (graceful fallback). 백업이 끊긴 상태로 운영되니 Railway 로그에서 `⚠️ R2 환경변수 미설정` 메시지 모니터링 필요.

## 자동 동작

### 정상 운영
1. 컨테이너 시작 → `start.sh` 실행
2. R2에 backup 있으면 `litestream restore`로 로컬 `alba.db` 복원
3. `litestream replicate -exec "node dist/index.js"` → 노드 서버를 자식 프로세스로 실행
4. 노드 서버가 alba.db에 쓰기마다 Litestream이 변경 감지 → 10초 내 R2로 PUT

### 재배포 / 컨테이너 재시작
1. Railway가 컨테이너 종료 → 노드 서버 종료 → Litestream 종료 (마지막 변경분 flush)
2. 새 컨테이너 시작 → `start.sh` 다시 실행
3. R2에서 최신 backup 다운로드 → 로컬 DB 복원 → 정상 운영
4. **이론적 RPO: 10초** (최악의 경우 마지막 10초 변경분 손실 가능)

## 수동 복원 절차

### 1. R2에서 특정 시점 복원 (로컬 머신에서)

```bash
# 1. Litestream 설치 (Mac)
brew install benbjohnson/litestream/litestream

# 2. litestream.yml을 임시로 만들어 R2 자격 설정
cat > /tmp/restore.yml <<EOF
dbs:
  - path: /tmp/alba-restored.db
    replicas:
      - type: s3
        endpoint: https://<account-id>.r2.cloudflarestorage.com
        bucket: alba-calculator-backup
        path: alba.db
        access-key-id: <ACCESS_KEY_ID>
        secret-access-key: <SECRET_ACCESS_KEY>
        region: auto
        force-path-style: true
EOF

# 3. 최신 시점 복원
litestream restore -config /tmp/restore.yml /tmp/alba-restored.db

# 4. 특정 시점 복원 (예: 2026-06-03 12:00 UTC)
litestream restore -timestamp 2026-06-03T12:00:00Z -config /tmp/restore.yml /tmp/alba-restored.db

# 5. SQLite 열어 확인
sqlite3 /tmp/alba-restored.db "SELECT count(*) FROM employees"
```

### 2. 운영 DB 교체 (긴급 롤백)
1. Railway 콘솔에서 서비스 일시 중지 (또는 사전 공지 후 진행)
2. 위 방법으로 원하는 시점 DB 복원 → 로컬에 `alba.db` 확보
3. Railway CLI 또는 콘솔 Shell로 컨테이너 접속 → `cat alba.db > /app/server/data/alba.db`
4. Railway 콘솔에서 컨테이너 재시작
5. ⚠️ 주의: 컨테이너 재시작 시 Litestream이 R2 → 컨테이너로 다시 복원할 수도 있음. 롤백 시 R2 백업도 먼저 삭제하거나, 새 버킷 prefix 사용

## 비용·한도

| 항목 | Cloudflare R2 무료 한도 | 예상 사용량 (alba-calculator) |
|---|---|---|
| 저장소 | 10 GB | 평생 수 MB 수준 (DB + 30일치 스냅샷) |
| Class A 작업 (PUT) | 100만/월 | sync-interval 10s × 60 × 60 × 24 × 30 ≈ 26만/월 → 안전 |
| Class B 작업 (GET) | 1,000만/월 | 평소 0, 복원 시에만 |
| Egress | **무료** ⭐ | 복원 비용 0 |

→ **사실상 영구 무료** 예상.

## 모니터링

### Railway 로그에서 정상 동작 확인
```
[start] R2 백업 환경변수 감지 — Litestream 모드
[start] R2 backup 있으면 복원 시도...
[start] Litestream replicate + node 서버 시작
level=INFO msg="initialized db" path=/app/server/data/alba.db
level=INFO msg="replicating to" name=s3 type=s3 ...
```

### R2 콘솔에서 백업 확인
Cloudflare 대시보드 → R2 → `alba-calculator-backup` 버킷 → `alba.db/` 폴더 안에 `snapshots/`, `wal/` 객체가 누적되는지 확인.

## 보안

- R2 API 토큰은 `alba-calculator-backup` 버킷에만 권한 (Object Read & Write) — 다른 버킷 접근 불가
- Railway 환경변수는 컨테이너 안에서만 접근 가능, GitHub 등 외부 노출 금지
- 토큰 유출 시 즉시 R2 콘솔에서 토큰 삭제 → 새 토큰 발급 → Railway 환경변수 교체 → 컨테이너 재시작

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| Railway 로그에 `⚠️ R2 환경변수 미설정` | 환경변수 4개 중 하나 누락 | Railway → Variables에서 4개 모두 등록 확인 |
| `Access Denied` | API 토큰 권한/버킷 일치 안 함 | 토큰 권한이 Object Read & Write인지, 버킷명 정확한지 확인 |
| `no such host` | R2_ENDPOINT 오타 | `https://<account-id>.r2.cloudflarestorage.com` 형식 확인 |
| 복원이 너무 오래 걸림 | 스냅샷이 너무 오래 전 (WAL 누적 큼) | snapshot-interval 짧게 조정 |
| 첫 배포 후 R2에 객체 안 생김 | sync-interval 안 지났거나 DB 쓰기 없음 | 직원 추가 등 쓰기 1회 발생시켜 확인 |
