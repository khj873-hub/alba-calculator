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

#### 서버리스 주의 — OAuth state 가 인메모리다

`oauth.ts` 의 `stateStore` 는 프로세스 메모리의 `Map` 이다. 서버리스에서는
`/start` 와 `/callback` 이 **다른 람다 인스턴스로 갈 수 있고**, 그러면
`잘못된 또는 만료된 요청` 으로 실패한다. 현재 트래픽에서는 인스턴스가 재사용돼
동작하지만 구조적으로 불안정하다. 로그인 실패가 산발적으로 보고되면
state 를 `sessions` 테이블 등 **공유 저장소로 옮길 것**.

## 남은 일

- [ ] 실제 사용 후 Railway 서비스 정리 (지금은 병행 가동)
- [ ] 구 클라이언트 보안 비밀번호(`****qctx`) 사용 중지·삭제
- [ ] OAuth `stateStore` 를 공유 저장소로 이전 (위 서버리스 주의 참고)
- [ ] 커스텀 도메인 연결 시 `PUBLIC_ORIGIN` 갱신 + 리디렉션 URI 재등록
- [ ] 기존 SQLite 데이터(`data/alba.db`, 테스트 데이터) 이전 여부 결정 — 현재 미이전
