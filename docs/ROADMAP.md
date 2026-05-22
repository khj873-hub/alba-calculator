# ROADMAP

브랜치 `feature/employee-access-modes` 에서 진행 중인 작업.
실 상용 업데이트 일정은 사용자 지시 시점에 결정.

## ✅ 완료된 클라이언트 변경 (이 브랜치 커밋에 포함)

### 1. 브랜드명 통일
- "급여 계산기" → "퍼펙트 근태관리" (직원 헤더 / 관리자 헤더 배지 / PDF 명세서 푸터)

### 2. 직원 페이지 토큰 링크 분리
- `client/src/api/index.ts` — 토큰 유틸 5종 (`getOrCreateEmployeeToken`, `regenerateEmployeeToken`, `resolveEmployeeIdByToken`, `removeEmployeeToken`, `buildEmployeeLink`)
- `App.tsx` — `/:slug/e/:token` 라우트 신설
- `HomePage` private 모드 안내
- `PersonalPage` 토큰 유효성 검사 + 🚫 안내
- `ManagerDashboard` 직원 카드에 🔗 출근 링크 복사 / 🔄 재발급 버튼

### 3. 직원별 급여 적용 ON/OFF
- `api/index.ts` — `isPayEnabled` / `setPayEnabled` / `removePayEnabled`
- `EmployeeFormPage` 시급 라벨 옆 토글, OFF 시 input 비활성
- `PersonalPage`, `ManagerPayrollPage` OFF 처리 (합계 0, "급여 미적용" 배지, 명세서 버튼 숨김)

### 4. 급여 탭 📊 엑셀(CSV) 다운로드
- UTF-8 BOM + CRLF + RFC 4180 이스케이프
- 파일명: `급여명세_{이름}_{YYYY년MM월}.csv`

### 5. 사업장별 홈 화면 모드
- `HomeMode` 타입 + `getHomeMode` / `setHomeMode` (localStorage, 기본 `kiosk`)
- `App.tsx` `/:slug/employee/:id` 라우트 복원 (토큰 라우트와 공존)
- `HomePage` 모드 분기
- `PersonalPage` id/token 둘 다 수용 + 모드 가드 (private에선 id 접근 차단)
- `ManagerDashboard` 🏠 홈 화면 모드 선택 섹션 신설

---

## ✅ v2 서버 마이그레이션 완료 (2026-05-22)

토큰·페이ON/OFF·홈모드 3건이 모두 서버에 영구 저장되어 다른 기기·시크릿창에서도 정상 작동.

### A. DB 마이그레이션
- [x] `employees.access_token` (TEXT, UNIQUE INDEX) — 기존 15명 자동 발급, INSERT 시 자동 생성
- [x] `employees.pay_enabled` (INTEGER NOT NULL DEFAULT 1)
- [x] `businesses.home_mode` (TEXT NOT NULL DEFAULT 'kiosk')

### B. API 추가
- [x] `GET /api/:slug/employees/by-token/:token` (인증 불필요)
- [x] `POST /api/:slug/employees/:id/regenerate-token` (관리자 세션)
- [x] `PATCH /api/businesses/:slug/home-mode` (관리자 세션) — PIN 대신 세션 토큰 사용으로 변경 (UX 일관성)
- [x] `clock-in` / `clock-out` body에 `token?: string` 추가, `employee_id` 호환 유지

### C. 클라이언트 동기화 전환
- [x] 토큰 유틸 — `employee.access_token` 직접 사용 + `fetchEmployeeByToken` / `regenerateEmployeeToken` 서버 호출
- [x] `pay_enabled` — `createEmployee` / `updateEmployee` body에 포함
- [x] `home_mode` — `business.home_mode` 응답 + `updateHomeMode` PATCH

### D. 배포
- [x] `npm run build` 성공
- [x] `main` 머지 + push → Railway 자동 빌드

---

## 검증 기준 (재개 시 통과 필요)
- TypeScript 타입 체크 (client + server) — EXIT 0
- 프로덕션 빌드 성공
- 보호 라우트 미인증 401 회귀
- 키오스크 / 개인 링크 두 모드 모두 브라우저 수동 확인
- 다른 기기(또는 시크릿창)에서 토큰 링크 접속 시 정상 동작

## 참고
- 테스트 결과: `docs/test/TEST_RESULT.md`
- 작업 컨텍스트 메모리: `~/.claude/projects/.../memory/project_alba_calculator_pending_server.md`
