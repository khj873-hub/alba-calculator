# alba-calculator 백업·복원 운영 매뉴얼

> 운영자(jinusoft19@gmail.com) 전용. 일반 사장님은 본 문서 볼 필요 없음 — 자동으로 처리됨.
> 최종 업데이트: 2026-06-03

## 아키텍처

```
Railway 컨테이너
  └─ node 서버 (포트 3002)
       └─ Backup 백그라운드 (server/src/backup.ts)
            ├─ 시작 직후 1회 백업
            ├─ setInterval 5분마다 자동
            │   1) better-sqlite3 .backup() → /tmp/snapshot.db
            │   2) S3 SDK PutObject → R2
            │   3) 30일 초과 객체 자동 삭제 (retention)
            ↓
Cloudflare R2 (alba-calculator-backup 버킷)
  └─ snapshots/
       └─ alba-2026-06-03T15-30-00-000Z.db (5분 간격)
       └─ alba-2026-06-03T15-35-00-000Z.db
       └─ ...
```

- DB 파일: `/app/server/data/alba.db` (컨테이너 내부, Railway volume)
- 백업 저장소: Cloudflare R2 `alba-calculator-backup`
- 구현: `server/src/backup.ts` — `@aws-sdk/client-s3` 기반
- 시작 호출: `server/src/index.ts`의 `app.listen` 콜백에서 `startBackup()`

## 환경변수 (Railway)

| 변수 | 예시 |
|---|---|
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | `alba-calculator-backup` |
| `R2_ACCESS_KEY_ID` | (Cloudflare R2 → API 토큰에서 발급) |
| `R2_SECRET_ACCESS_KEY` | (한 번만 표시되므로 즉시 저장) |

네 개 중 하나라도 없으면 백업 비활성화(graceful) — 서버는 정상 시작하지만 백업 안 됨. Railway 로그에 `[backup] ⚠️  R2 환경변수 미설정 — 백업 비활성화` 메시지 모니터링 필요.

## 자동 동작

| 빈도 | 작업 |
|---|---|
| **시작 직후 1회** | snapshot + R2 PUT + retention 정리 |
| **5분마다 (setInterval)** | snapshot + R2 PUT + retention 정리 |
| **매 백업 후** | R2에서 30일 초과 객체 자동 삭제 |

**RPO**: 최악 5분 (마지막 백업 후 발생한 변경분 손실 가능). 평균 2.5분.

## 객체 명명 규칙

```
snapshots/alba-2026-06-03T15-30-00-000Z.db
```
- prefix: `snapshots/`
- ISO 8601 타임스탬프 (콜론·점은 하이픈으로 치환 — S3 키 호환)
- 확장자: `.db` (SQLite 파일)

## 수동 복원 절차

### 1. R2에서 원하는 시점 파일 다운로드 (로컬 머신)

```bash
# AWS CLI 또는 boto3 사용
python3 -c "
import boto3
s3 = boto3.client('s3',
    endpoint_url='https://<account-id>.r2.cloudflarestorage.com',
    aws_access_key_id='...',
    aws_secret_access_key='...',
    region_name='auto')

# 가장 최근 파일 찾기
r = s3.list_objects_v2(Bucket='alba-calculator-backup', Prefix='snapshots/')
latest = max(r['Contents'], key=lambda x: x['LastModified'])
print(f'다운로드: {latest[\"Key\"]} ({latest[\"Size\"]} B)')

# 다운로드
s3.download_file('alba-calculator-backup', latest['Key'], '/tmp/alba-restored.db')
print('완료: /tmp/alba-restored.db')
"

# 검증
sqlite3 /tmp/alba-restored.db "SELECT count(*) FROM employees"
```

### 2. 특정 시점 복원
ISO 타임스탬프로 정확한 파일 선택:
```python
target_key = 'snapshots/alba-2026-06-03T12-00-00-000Z.db'
s3.download_file('alba-calculator-backup', target_key, '/tmp/alba-restored.db')
```

### 3. 운영 DB 교체 (긴급 롤백)
1. Railway 콘솔에서 서비스 일시 중지 (또는 사전 공지 후 진행)
2. 로컬에 복원 파일 확보 (위 2번)
3. Railway CLI Shell 또는 deploy hook으로 컨테이너 접속 후:
   ```bash
   cat /tmp/alba-restored.db > /app/server/data/alba.db
   ```
4. Railway 콘솔에서 컨테이너 재시작
5. 5분 안에 새 자동 백업이 시작되어 복원된 DB로부터 새 generation 시작

⚠️ 주의: 컨테이너 재시작 시 자동 백업 timer가 다시 5분 사이클 시작.

## 비용·한도

| 항목 | Cloudflare R2 무료 한도 | 예상 사용량 (alba-calculator) |
|---|---|---|
| 저장소 | 10 GB | 5분 × 30일 = 8,640 객체 × 평균 5MB ≈ 43 GB — 큰 사업장 시 한도 초과 가능 ⚠️ |
| Class A 작업 (PUT, DELETE, LIST) | 100만/월 | 5분 PUT × 30일 × 약간의 DELETE/LIST = 약 10,000/월 → 안전 |
| Class B 작업 (GET, HEAD) | 1,000만/월 | 평소 0, 복원 시에만 |
| Egress | **무료** ⭐ | 복원 비용 0 |

→ DB가 크게 자라면 무료 저장 한도(10 GB) 넘을 수 있음. 운영 6개월 이상 가서 한도 근접하면:
- 보관 기간 30일 → 7일로 단축
- 또는 백업 간격 5분 → 15분으로 늘림
- 또는 R2 유료 전환 ($0.015/GB/월)

## 모니터링

### Railway 로그에서 정상 동작 확인
```
Alba server running on http://localhost:3002
[backup] R2 백업 활성 — 5분 간격, 30일 보관 (bucket=alba-calculator-backup)
[backup] 시작 시 1회 백업 시도...
[backup] ✓ snapshots/alba-2026-06-03T15-30-00-000Z.db (4.20 MB)
[backup] retention: 0개 삭제 (30일 초과)
```

### R2 콘솔에서 백업 확인
Cloudflare 대시보드 → R2 → `alba-calculator-backup` → `snapshots/` 폴더 → 5분 간격으로 새 객체 누적되는지 확인.

## 보안

- R2 API 토큰은 `alba-calculator-backup` 버킷에만 권한 (Object Read & Write)
- Railway 환경변수는 컨테이너 안에서만 접근 가능
- 토큰 유출 시 즉시 R2 콘솔에서 토큰 삭제(또는 "롤") → 새 토큰 발급 → Railway 환경변수 `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` 2개 교체 → Redeploy 수동 트리거

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| `[backup] ⚠️ R2 환경변수 미설정` | env 4개 중 하나 누락 | Railway → Variables 4개 모두 등록 확인 |
| `[backup] ✗ 실패: AccessDenied` | 토큰 권한 부족 | R2 콘솔에서 토큰 권한이 Object Read & Write 확인, 버킷 매칭 |
| `[backup] ✗ 실패: NoSuchBucket` | 버킷명 오타 | R2_BUCKET 환경변수 정확한지 확인 |
| 백업이 5분보다 자주 안 보임 | 정상 동작 (5분 간격) | — |
| 저장 한도 임박 | 5분 × 30일 누적이 큼 | RETENTION_DAYS 조정 또는 INTERVAL_MS 조정 (backup.ts) |

## 파라미터 조정

`server/src/backup.ts` 상단 상수 변경:
```typescript
const INTERVAL_MS = 5 * 60 * 1000      // 백업 간격 (5분)
const RETENTION_DAYS = 30              // 보관 기간 (30일)
const PREFIX = 'snapshots/'            // R2 키 prefix
```

변경 후 commit·머지·재배포.
