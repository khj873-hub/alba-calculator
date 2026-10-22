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

### ⚠️ boolean 은 두 번에 걸쳐 다 못 잡았다 (2026-10-22 추가 12곳)

5번에서 "파라미터로 넘기는 자리"만 고쳤다. **SQL 문자열에 박힌 리터럴**과
**JS 쪽 `=== 0 / !== 1` 비교**가 남아 있었고, 6일 뒤에야 증상으로 드러났다.

| 남아 있던 곳 | 실제 증상 |
|---|---|
| `INSERT … time_off_enabled) VALUES (…, 0)` 2곳 | **사업장 생성이 전부 실패** (PG: boolean 자리에 integer) |
| `UPDATE … is_active = 1` | 기한 연장 시 자동 활성화 안 됨 |
| `is_active === 0` 서버 3곳 | **정지된 사업장이 차단되지 않음** (미들웨어·OAuth·자동활성화) |
| `is_active === 1` 클라이언트 6곳 | 운영자 콘솔이 **모든 사업장을 "🔴 정지"로 표시** |
| `sms_notify_enabled !== 1` 2곳 | **출퇴근 SMS 알림이 아예 발송되지 않음** |
| `time_off_enabled === 1`, `weekly_holiday_includes_leave === 1` | 휴가·주휴수당 설정이 무시됨 |

**교훈**: 타입이 바뀌면 파라미터뿐 아니라 ①SQL 리터럴 ②JS 비교 ③프런트 타입 선언까지
한 번에 훑어야 한다. 프런트 타입을 `number` 로 남겨두면 컴파일러가 잡아주지도 않는다.
지금은 서버·클라이언트 전체에 boolean 컬럼의 `=== 0/1` 비교가 0건이다.

## 환경변수 (Vercel production)

`DATABASE_URL`(Supabase Transaction pooler 6543), `MANAGER_PIN`, `PUBLIC_ORIGIN`,
`GOOGLE_CLIENT_ID/SECRET`, `ADMIN_EMAILS`, `RESEND_*`, `SOLAPI_*`, `SENDER_PHONE`, `KAKAO_PFID`

- `DATABASE_URL` 비밀번호에 특수문자가 있으면 **URL 인코딩 필수** (`#` → `%23`)
- `PORT`·`NODE_ENV` 는 Vercel 이 관리하므로 설정하지 않음
- R2 백업 변수는 더 이상 불필요

## 검증 (배포 환경)

health ✅ / 프론트·SPA 라우팅 ✅ / PIN 인증 ✅ / 직원 생성·목록 ✅ / 출근·퇴근 ✅
로컬 실서버에서는 추가로 요금제 게이트, 트랜잭션 3종(스케줄 저장·CSV 일괄등록·부서삭제) 통과.

### 구글 운영자 로그인 — OAuth 클라이언트 재발급 (2026-10-17 해결)

이전 후 운영자 구글 로그인이 **`redirect_uri_mismatch` (오류 400)** 로 막혔다.
도메인이 Railway → `perfect-work.vercel.app` 으로 바뀌었는데 구글 콘솔에
새 리디렉션 URI 가 등록돼 있지 않았던 것. 코드·환경변수 문제가 아니었다.

**등록하려 했으나 기존 클라이언트에 접근할 수 없었다.** 기존 클라이언트
(`698915511621-2he659dlk…`)는 구글 클라우드 프로젝트 `alba-calculator-497506`
소속인데, 이 프로젝트가 어느 계정 소유인지 찾지 못했다 —
jinusoft19·khj873 양쪽 모두 리소스 관리자 목록에 뜨지 않았다.

실고객 없는 테스트 단계라 **새 클라이언트를 발급**하는 쪽으로 정리했다.

| 항목 | 값 |
|---|---|
| 구글 클라우드 프로젝트 | `perfect-attendance-e2b71` (**jinusoft19@gmail.com** 소유, Firebase 겸용) |
| 클라이언트 이름 | `perfect-work (Vercel)` |
| 클라이언트 ID | `414891766609-irmiobsv66id86rvbgrm8j3gfkkhol59.apps.googleusercontent.com` |
| 리디렉션 URI | `https://perfect-work.vercel.app/api/auth/google/callback`<br>`http://localhost:5174/api/auth/google/callback` |
| JS 원본 | `https://perfect-work.vercel.app` |
| 게시 상태 | **테스트 중** (외부) |
| 테스트 사용자 | `jinusoft19@gmail.com`, `khj873@gmail.com` |

Vercel production 의 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET` 을 교체하고
재배포(소스 동일, 설정만 갱신) 후 **운영자 로그인·콘솔 데이터 로딩까지 정상 확인**.

**⚠️ 계정이 갈라져 있다**: 구글 클라우드는 jinusoft19, Vercel·GitHub·Railway 는
khj873. 브라우저 프로필도 분리돼 있어 콘솔 작업 시 계정을 확인할 것
(`?authuser=jinusoft19@gmail.com` 을 붙이면 해당 계정으로 열린다).

#### 알아둘 것

- **게시 상태가 "테스트 중"이라 테스트 사용자로 등록된 계정만 로그인된다.**
  직원·사장에게도 구글 로그인을 열려면 앱을 **게시**해야 한다(브랜딩 정보 입력 필요).
  운영자 전용으로만 쓰는 지금은 테스트 모드로 충분하다.
- `redirect_uri` 는 `PUBLIC_ORIGIN` 으로 만들어진다(`server/src/routes/oauth.ts`).
  **도메인을 바꿀 때마다 콘솔에 리디렉션 URI 등록을 같이 해야 한다.**
- 운영자 세션은 쿠키가 아니라 **토큰**이다. 콜백이 `/admin#token=…` 으로 돌려주고
  프런트가 보관해 헤더로 보낸다. 그래서 `/api/admin/me` 를 브라우저에서 직접 열면
  **성공했어도 401** 이 나온다 — 검증은 콜백 후 돌아온 주소로 판단할 것
  (`/admin#token=…` 성공 / `/admin?oauth_error=…` 권한 없음 / `/?oauth_error=…` 토큰 교환 실패).
- 보안 비밀번호가 2개 남아 있다(최초 발급분은 값을 모름 — 생성 직후 대화상자를
  닫으면 다시 볼 수 없다). 쓰이지 않는 구 버전은 정리 대상.

#### OAuth state — 인메모리였던 것을 DB 로 옮겼다 (2026-10-22)

`oauth.ts` 의 `stateStore` 는 프로세스 메모리의 `Map` 이었다. 서버리스에서는
`/start` 와 `/callback` 이 **다른 람다 인스턴스로 갈 수 있어** 그때마다
`잘못된 또는 만료된 요청` 으로 로그인이 간헐 실패한다(인스턴스 재사용 덕에
겉으로는 동작하고 있었다).

신규가입 토큰과 같은 방식으로 `sessions` 테이블에 `__oauth__:` + JSON 으로
저장하고 콜백에서 1회 소비한다(TTL 10분). `requireManagerAuth`·`requireAdminAuth`
는 `session.slug` 가 대상 slug 와 **정확히 같아야** 통과하므로 `__oauth__:` 행이
세션으로 오용될 수는 없다.

실측 검증: 없는 state → `잘못된 또는 만료된 요청`, `/start` 가 발급한 state 를
**별도 요청**으로 콜백에 넣으면 state 조회를 통과해 `토큰 검증 실패`(code 가 가짜라
정상)까지 간다 = 요청 간에 state 가 공유된다.

## 퍼펙트 AI 매니저 연동 (2026-10-22)

`server/src/routes/agent.ts` — `/api/agent/{stores,employees,attendance}`.
`x-agent-token` 인증, `AGENT_STORE_SLUG` 로 지정한 **한 매장만** 노출(PII 제외).

⚠️ 이 라우트는 09-24 에 머지(PR #25)됐는데, **10-16 이전 작업을 그 커밋을 못 받은
로컬 main 에서 해서 배포본에서 빠졌다**. 그 바람에 AI 매니저 채팅이 404 로 전부
죽어 있었다(10-22 발견·복구). 포팅 시 `db` 직접 import + 모든 `.all()` 에 `await`.

환경변수 `AGENT_READ_TOKEN`(AI 매니저의 `ATTENDANCE_API_TOKEN` 과 동일값),
`AGENT_STORE_SLUG`(현재 `k35321`). 자세한 내용은 [[perfect-ai-manager]] 저장소의 `CLAUDE.md`.

## 근태 일괄 입력 API (2026-10-22 신설)

`POST /api/:slug/attendance/bulk` — 관리자 인증(`requireManagerAuth`).

과거 기록을 넣을 수단이 없었다. 생성은 실시간 `clock-in` 뿐, 수정은 단건 `PUT` 뿐이라
**기존 고객 데이터 이관도, 테스트 시드도 만들 수 없었다.**

```
POST /api/k35321/attendance/bulk
x-session-token: <관리자 세션>
{ "records": [ { "employee_id": 6, "clock_in": "2026-10-20 09:00:00",
                 "clock_out": "2026-10-20 18:00:00", "memo": null } ] }
→ { "ok": true, "inserted": 25 }
```

- 시각은 공통 규칙대로 **KST 벽시계 문자열** `"YYYY-MM-DD HH:MM:SS"`
- **전수 검증 후 전부 성공 아니면 전부 실패**(트랜잭션). 실패 시 어느 인덱스가 왜
  틀렸는지 최대 20건까지 돌려준다
- 요청한 사업장 소속 직원만 허용 — 타 사업장 `employee_id` 차단
- **SMS 알림을 보내지 않는다.** 과거 기록을 넣는데 지금 알림이 가면 안 된다
- 1회 최대 1,000건

실측: 매장 `k35321` 에 2주치 25건을 한 번에 입력 성공.

## 남은 일

- [ ] Railway 서비스 정리 — 프로젝트 `unique-liberation`/서비스 "알바 계산기" + 볼륨이
      아직 남아 있다(2026-10-22 기준 Railway 플랫폼 장애로 전체 중지). 구 운영 데이터
      (매장 `xacyqf` 등)가 그 볼륨에 있으나 **복구하지 않기로 결정**했다.
- [ ] 구 OAuth 클라이언트 보안 비밀번호(`****qctx`) 사용 중지·삭제
- [ ] 커스텀 도메인 연결 시 `PUBLIC_ORIGIN` 갱신 + 리디렉션 URI 재등록
- [ ] 기존 SQLite 데이터(`data/alba.db`)는 이전하지 않았다. 필요해지면 위 일괄 입력
      API 로 넣을 수 있다.
