# alba-calculator (퍼펙트 근태관리) — 개발 구조

> 최종 업데이트: 2026-06-03
> 서비스 URL: https://alba-calculator-production.up.railway.app
> 운영자: jinusoft19@gmail.com

## 한 줄 요약

사장님 단위 사업장 등록 → 직원별 출퇴근 GPS 체크 → 자동 급여·주휴수당·휴가 계산 → PDF/CSV 명세서 발행 + Cloudflare R2 5분 자동 백업.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind + React Router |
| Backend | Node 20 + Fastify + TypeScript |
| DB | SQLite (better-sqlite3, WAL 모드) |
| 인증 | PIN 해시(scrypt) + 24h 세션 토큰 + 구글 OAuth 백업 |
| 배포 | Railway (Nixpacks) |
| 백업 | Cloudflare R2 (@aws-sdk/client-s3, 5분 간격, 30일 retention) |
| 도메인 | `alba-calculator-production.up.railway.app` |

---

## 디렉토리 구조

```
alba-calculator/
├─ server/                       Node + Fastify 백엔드
│  └─ src/
│     ├─ index.ts                서버 시작·플러그인 등록·startBackup() 호출
│     ├─ db.ts                   SQLite 연결·마이그레이션·해시 유틸
│     ├─ backup.ts               R2 자동 백업 (setInterval 5분)
│     ├─ middleware/auth.ts      requireManagerAuth (PIN/구글 세션 검증)
│     └─ routes/
│        ├─ businesses.ts        사업장 CRUD·휴가 정책·주휴수당 정책
│        ├─ employees.ts         직원 CRUD·시급·주휴 포함 모드 토글
│        ├─ attendance.ts        출퇴근·payroll(주휴수당 자동 계산)
│        ├─ timeOff.ts           휴가 등록·조회 (4종: 연차/무급/병가/경조사)
│        ├─ oauth.ts             구글 OAuth (백업 인증)
│        ├─ admin.ts             /admin 운영자 콘솔 (사업장 정지·결제 만료)
│        └─ inquiries.ts         도입 문의 폼 + Resend 이메일 (현재 보류)
│
├─ client/                       React + Vite 프론트엔드
│  └─ src/
│     ├─ pages/
│     │  ├─ LandingPage.tsx                홍보·후기·신청
│     │  ├─ HomePage.tsx                   사업장 리스트 진입
│     │  ├─ CreateBusinessPage.tsx         신규 등록 (직접)
│     │  ├─ BusinessListPage.tsx           사업장 목록
│     │  ├─ PersonalPage.tsx               직원 출퇴근·예상급여 (포함모드 분기)
│     │  ├─ PINPage.tsx                    관리자 로그인
│     │  ├─ AdminPage.tsx                  /admin 운영자 콘솔
│     │  ├─ LegalPage.tsx                  이용약관·개인정보처리방침
│     │  └─ manager/
│     │     ├─ ManagerDashboard.tsx        직원 카드·휴가/주휴정책·GPS·홈모드
│     │     ├─ EmployeeFormPage.tsx        직원 추가·수정·주휴포함 토글
│     │     ├─ ManagerAttendancePage.tsx   월별 근태·휴가 등록·편집
│     │     └─ ManagerPayrollPage.tsx      급여 계산·명세서 PDF/CSV
│     ├─ components/  레이아웃·문의폼·정지안내·카카오 플로팅
│     ├─ hooks/useSlug.ts
│     ├─ utils/pay.ts                      calcWeeklyHolidayPay (client-side mirror)
│     ├─ utils/segments.ts                 야간 자정 분할
│     ├─ utils/geo.ts                      GPS 거리 계산 (Haversine)
│     ├─ api/index.ts                      서버 API 래퍼
│     └─ types.ts                          Business/Employee/Payroll 인터페이스
│
├─ data/                         SQLite (Railway volume 마운트)
│  └─ alba.db (+ -wal, -shm)
├─ docs/
│  ├─ ARCHITECTURE.md            이 문서
│  ├─ MANAGER_GUIDE.md           사장님 상세 매뉴얼 (14장)
│  ├─ USER_GUIDE.md              통합 짧은 가이드 (7장)
│  ├─ BACKUP.md                  운영자용 백업·복원 매뉴얼
│  ├─ ROADMAP.md                 v3 Step 2~4 로드맵
│  ├─ LOCAL_OAUTH_SETUP.md       구글 OAuth 로컬 개발
│  ├─ legal/                     약관·개인정보처리방침 원본
│  └─ planning/                  기획 문서
├─ nixpacks.toml                 Railway 빌드 설정
└─ railway.json                  Railway 배포 설정
```

---

## 데이터 모델 (SQLite 테이블 7개)

```
users          관리자 인증 (PIN scrypt 해시, 구글 sub, ADMIN_EMAILS)
sessions       24시간 세션 토큰
businesses     사업장 (slug, name, manager_pin_hash, GPS lat/lng/radius,
                home_mode='kiosk|private', leave_pay_calc_mode='8hours|avg_workhours',
                weekly_holiday_includes_leave, time_off_enabled,
                weekly_holiday_threshold_hours(15기본), week_start_day(1=월),
                plan='free|paid', plan_expires_at, status='active|suspended',
                google_email)
employees      직원 (name, hourly_rate, color, access_token,
                pay_enabled(급여계산 ON/OFF), pay_includes_holiday(주휴포함 모드))
attendance     출퇴근 (clock_in, clock_out, memo)
time_off       휴가 (date, type='annual|unpaid|sick|family', portion, half_period, memo)
inquiries      도입 문의 (business_name, phone, content, agreed_privacy/marketing)
```

마이그레이션: `server/src/db.ts`에서 `PRAGMA table_info`로 컬럼 존재 여부 확인 후 idempotent ALTER TABLE.

---

## 핵심 비즈니스 로직

| 로직 | 위치 | 특징 |
|---|---|---|
| 주휴수당 자동 계산 | `attendance.ts:calcWeeklyHolidayPay` | 사업장 기준 시간(15/20/30 가변) + 주차 시작 요일(월/일) 반영 |
| 주휴 시급 포함 모드 | `attendance.ts` + `EmployeeFormPage` | `pay_includes_holiday=1`이면 자동 산정 0원, 명세서에 분해 표기 |
| 야간 근무 자정 분할 | `utils/segments.ts` | 22~6시 같은 자정 넘는 근무 자동 두 날짜로 분리 |
| 유급휴가 환산 | `attendance.ts` | `8hours` 또는 `avg_workhours` 두 모드 |
| GPS 위치 제한 | `attendance.ts` + `utils/geo.ts` | Haversine 거리, 관리자 세션은 우회 |
| 키오스크/개인 링크 | `home_mode` 컬럼 | 같은 사업장에서 둘 중 한 가지 모드 |
| 휴게시간 1시간 공제 | `ManagerPayrollPage.getAdjusted` | 일 4시간 이상 근무 시 60분 자동 차감 |
| 3.3% 사업소득세 공제 | client 명세서 | 단기·프리랜서 토글 |

### 급여 계산식 (요약)

```
기본급        = (총 근무 분 / 60) × 시급
주휴수당      = (주 근무시간 / 40) × 8 × 시급
                (사업장 기준 시간 이상 + 직원별 ON일 때, 포함 모드 직원은 0)
유급 연차    = 시급 × 8h (또는 평균 근무시간 × 시급)
총 지급액    = 기본급 + 주휴수당 + 유급 연차
3.3% 공제    = 총 지급액 × 0.033
실수령액    = 총 지급액 × 0.967
```

---

## 인증·권한 매트릭스

| 작업 | 인증 |
|---|---|
| 직원 출퇴근 (직접) | 비인증, `access_token`만으로 |
| 직원 출퇴근 조회 | 비인증 |
| 직원 개인 페이지 | `access_token` 매칭 |
| 관리자 모든 작업 (직원 CRUD·휴가·정책·근태 편집) | `requireManagerAuth` — PIN 세션 또는 구글 세션 |
| 운영자 콘솔 (`/admin`) | `ADMIN_EMAILS` 환경변수 + 구글 세션 |
| 도입 문의 제출 | 비인증 + rate limit |

---

## 배포·운영 인프라

```
GitHub khj873-hub/alba-calculator (main)
    ↓ push
Railway 자동 빌드 (Nixpacks)
    ├─ nodejs_20, python3 (sqlite native build)
    ├─ server/client npm install + tsc + vite build
    └─ Volume mount: /app/server/data (alba.db 영구 저장)
    ↓ 시작
node /app/server/dist/index.js (포트 8080)
    ├─ Fastify 서버
    ├─ 정적 파일 (client/dist) 서빙
    └─ startBackup() — 5분 간격 setInterval
              ↓
       Cloudflare R2 alba-calculator-backup/snapshots/
                                     ↓ 30일 retention 자동 삭제
```

### 빌드 단계 (nixpacks.toml)
1. setup: `nodejs_20`, `python3` (better-sqlite3 native build용)
2. install: `cd server && npm install --include=dev` + `cd client && npm install --include=dev`
3. build: `cd server && npm run build` + `cd client && npm run build`
4. start: `cd server && node dist/index.js`

### 환경변수 (Railway)

```
PUBLIC_ORIGIN                              서비스 URL
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET    OAuth
ADMIN_EMAILS                               콤마구분 운영자 이메일
RESEND_API_KEY                             도입문의 알림 (보류 — 현재 미작동)
R2_ENDPOINT, R2_BUCKET, 
R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY    백업 (trim 처리 필수)
```

### Railway 트랩 (운영 메모)
- **환경변수 추가 후 자동 redeploy 안 됨** — 수동 Redeploy 필요
- **환경변수 복사·붙여넣기 시 trailing whitespace/newline 섞임** — `backup.ts`에서 `.trim()` 처리
- **railway.json startCommand가 nixpacks의 [start]를 override** — 시작 명령 변경 시 둘 다 동기화

---

## 자동 백업 (Cloudflare R2)

| 항목 | 값 |
|---|---|
| 방식 | node 서버 내부 setInterval (`server/src/backup.ts`) |
| 주기 | 5분 간격 |
| 보관 | 30일 (오래된 객체 자동 삭제) |
| RPO | 5분 (최악의 경우 5분 데이터 손실) |
| 저장소 | Cloudflare R2 `alba-calculator-backup` 버킷 |
| 파일 형식 | `snapshots/alba-YYYY-MM-DDTHH-mm-ss-msZ.db` (better-sqlite3 `.backup()` 결과) |
| SDK | `@aws-sdk/client-s3` (S3 호환) |

**시도 → 폐기한 옵션 (참고)**:
- Litestream (PR #16~#20): v0.3.13 시작은 정상이나 R2 PUT 0건의 silent fail. boto3로 같은 자격증명 직접 PUT은 성공해서 권한·endpoint 정상 확인. 원인 미진단 (black box). 더 단순·안정적 방식으로 전환.

자세한 복원 절차·트러블슈팅: [BACKUP.md](BACKUP.md)

---

## 외부 통합

| 서비스 | 용도 |
|---|---|
| Cloudflare R2 | DB 백업 (S3 호환 API) |
| Google OAuth | 백업 관리자 인증 |
| Resend | 도입 문의 이메일 알림 (현재 보류) |
| Google Forms | 신청 폼 (백업 진입점) |

---

## 운영 자동화

- **사업장 정지 미들웨어**: `plan_expires_at` 지나면 자동 `suspended` 처리 → 직원 페이지에 정지 안내
- **R2 백업**: 시작 직후 + 5분마다 + 30일 retention
- **세션 만료**: 24시간 자동
- **마이그레이션**: 컨테이너 시작 시 `PRAGMA table_info` 체크 후 idempotent ALTER TABLE

---

## 매뉴얼

| 문서 | 대상 | 분량 |
|---|---|---|
| [MANAGER_GUIDE.md](MANAGER_GUIDE.md) | 사장님 | 14장 · 약 18KB |
| [USER_GUIDE.md](USER_GUIDE.md) | 통합 (사장+직원) | 7장 · 약 12KB |
| [BACKUP.md](BACKUP.md) | 운영자 (백업·복원) | 5장 |
| [ROADMAP.md](ROADMAP.md) | 개발 — v3 Step 2~4 |
| [LOCAL_OAUTH_SETUP.md](LOCAL_OAUTH_SETUP.md) | 개발 — 로컬 OAuth |

---

## 향후 로드맵 (요약)

| Step | 내용 | 시점 |
|---|---|---|
| v3 Step 2 | 입사일 기반 연차 자동 적립 (월 1일 → 연 15일 → 2년마다 +1일) | 예정 |
| v3 Step 3 | 직원별 연봉제/시급제 + 5인 미만 사업장 자동 분기 | 예정 |
| v3 Step 4 | 미사용 연차 수당 정산, 사용 촉진 기록, 소멸시효(3년), 퇴직 정산(14일) | 예정 |
| 결제 시스템 | 정식 요금제 / 카드 결제 / 사업장 자동 활성·정지 | 예정 |

자세한 기획: `docs/planning/`

---

## 문의·기술 지원

- **이메일**: jinusoft19@gmail.com
- **GitHub**: https://github.com/khj873-hub/alba-calculator
- **신청 폼**: [구글 폼](https://docs.google.com/forms/d/e/1FAIpQLSfqabZynjYejxaNUbJoCAL1LmBFZh5a1lCF4WudjaNvFEtVkg/viewform)
