# Railway → Vercel + Supabase 이전 기록 (2026-10-16)

## 결과

| 항목 | 이전 | 이후 |
|---|---|---|
| 호스팅 | Railway (상주 서버 + 볼륨) | **Vercel** (정적 client + 서버리스 /api) |
| DB | better-sqlite3 (파일 `data/alba.db`) | **Supabase Postgres** |
| 백업 | `setInterval` → R2 스냅샷 | Supabase 자동 백업 (코드 제거) |
| 배포 URL | Railway | **https://perfect-work.vercel.app** |

- Vercel 프로젝트: `perfect-work` (팀 khj873-1573s-projects)
- Supabase: `perfect-ai-manager` 프로젝트에 근태 10테이블 추가 (무료 플랜 활성 2개 제한 때문)
- Railway 배포는 **아직 살아 있음** — Vercel 안정화 확인 후 정리할 것

## ⚠️ 주의: perfect-attendance 는 랜딩 프로젝트다

Vercel 프로젝트 `perfect-attendance` = **랜딩 페이지**(perfect.jinusoft.com).
이전 작업 중 이 프로젝트에 앱을 잘못 배포해 랜딩이 덮어써진 사고가 있었고 rollback 으로 복구했다.
**근태 앱은 반드시 `perfect-work` 에 배포할 것.**

## 구조

```
/                → client/dist (Vercel 정적)
/api/*           → api/index.ts (Vercel 함수) → Fastify app
```

- `api/index.ts`: Fastify 를 listen 하지 않고 `app.server.emit('request')` 로 위임. ready/seed 는 콜드스타트당 1회.
- `server/src/index.ts`: `process.env.VERCEL` 이면 listen·정적서빙 생략 (다른 환경 동작은 그대로)
- `vercel.json`: 정적 + `/api/*` rewrite + SPA fallback

## DB 어댑터 (server/src/db.ts)

기존 `db.prepare(sql).get/all/run()` 시그니처를 유지해 **SQL 227문장을 그대로 보존**했다.

- `?` → `$1` 자동 변환
- INSERT 에 `RETURNING id` 를 붙여 `lastInsertRowid` 호환
- int8(id·COUNT)을 number 로 파싱 — string(기본)·BigInt 둘 다 JSON 직렬화 문제가 있어 커스텀 파서 사용
- **AsyncLocalStorage 로 트랜잭션 연결 전파** — 없으면 트랜잭션 내부 쿼리가 풀의 다른 연결을 집어
  롤백이 안 되고, `max:1` 에서는 데드락이 난다

## 전환 중 발견·수정한 실제 버그

1. `planLimitBlock` await 누락 → Promise 가 항상 truthy 라 **직원 등록이 전부 차단**되던 버그
2. `employees.map(attachStatus)` → `Promise.all` 누락으로 목록이 `[{},{}]`
3. CSV 일괄등록 `forEach(async)` → async 콜백 미대기 (for...of 로 교체)
4. 트랜잭션 데드락 (위 AsyncLocalStorage)
5. boolean 컬럼에 `0/1` 전달 10곳 → PG 가 거부
6. `datetime('now','localtime')` → `now()`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
7. `attendanceGate` 유니온 narrowing — 로컬 tsc 5.9.3 은 통과, Vercel 빌드 tsc 는 실패

## 환경변수 (Vercel production)

`DATABASE_URL`(Supabase Transaction pooler 6543), `MANAGER_PIN`, `PUBLIC_ORIGIN`,
`GOOGLE_CLIENT_ID/SECRET`, `ADMIN_EMAILS`, `RESEND_*`, `SOLAPI_*`, `SENDER_PHONE`, `KAKAO_PFID`

- `DATABASE_URL` 비밀번호에 특수문자가 있으면 **URL 인코딩 필수** (`#` → `%23`)
- `PORT`·`NODE_ENV` 는 Vercel 이 관리하므로 설정하지 않음
- R2 백업 변수는 더 이상 불필요

## 검증 (배포 환경)

health ✅ / 프론트·SPA 라우팅 ✅ / PIN 인증 ✅ / 직원 생성·목록 ✅ / 출근·퇴근 ✅
로컬 실서버에서는 추가로 요금제 게이트, 트랜잭션 3종(스케줄 저장·CSV 일괄등록·부서삭제) 통과.

## 남은 일

- [ ] 실제 사용 후 Railway 서비스 정리 (지금은 병행 가동)
- [ ] 커스텀 도메인 연결 시 `PUBLIC_ORIGIN` 갱신 + Google OAuth redirect URI 등록
- [ ] 기존 SQLite 데이터(`data/alba.db`, 테스트 데이터) 이전 여부 결정 — 현재 미이전
