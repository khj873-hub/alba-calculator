# P0 휴가 기능 테스트 결과 보고서

## 실행 일시
2026-05-26

## 대상
`feature/time-off` 브랜치 — 휴가(연차/무급/병가/경조사) 등록·급여 반영 P0

## 테스트 결과 요약

| 영역 | 전체 | 통과 | 실패 | 스킵 |
|---|---|---|---|---|
| API CRUD | 8 | 8 | 0 | 0 |
| 엣지 케이스/보안 | 10 | 10 | 0 | 0 |
| payroll 계산 | 8 | 8 | 0 | 0 |
| 정책 PATCH | 5 | 5 | 0 | 0 |
| 환산 모드 | 1 | 1 | 0 | 0 |
| 주휴 토글 영향 | 2 | 2 | 0 | 0 |
| Cascade 삭제 | 2 | 2 | 0 | 0 |
| 마이그레이션 | 3 | 3 | 0 | 0 |
| 마스터 토글 (time_off_enabled) | 9 | 9 | 0 | 0 |
| **합계 (자동)** | **48** | **48** | **0** | **0** |

UI 수동 확인 항목 별도 가이드 (사용자 진행).

---

## 발견·수정된 버그

### 🐛 Bug #1 (Critical) — UNIQUE 제약 NULL 우회로 1일 휴가 중복 등록 가능
- **증상**: `portion=1.0`(하루) 휴가는 같은 `employee_id+date`로 무한 등록됐음
- **원인**: SQLite의 `UNIQUE(employee_id, date, half_period)`는 NULL을 distinct로 취급. 1일 휴가는 `half_period=NULL`로 저장되어 NULL=NULL이 false로 평가됨
- **수정**:
  - `half_period`를 `NOT NULL DEFAULT 'full'`로 변경
  - CHECK 제약 `IN ('am','pm','full')`로 확장
  - 라우트에서 1일 휴가 INSERT 시 `'full'` 자동 채움
  - 구 스키마 DB 자동 마이그레이션: 임시 테이블 → COALESCE 변환 → DROP/RENAME
- **검증**: 신규 DB 중복 등록 시 409 반환, 마이그레이션 후에도 동일하게 차단

### 🐛 Bug #2 (Edge) — avg_workhours 모드에서 누적 분 0이면 paid_leave_pay=0
- **증상**: 출근일이 있어도 누적 시간이 0(1분 미만)이면 환산이 0이 됨
- **원인**: `avgMins = workDays > 0 ? total_minutes / workDays : 8*60` — workDays>0이지만 total_minutes=0일 때 0으로 나옴
- **수정**: 조건을 `workDays > 0 && total_minutes > 0`로 변경. 둘 중 하나라도 0이면 8시간 fallback
- **검증**: 출근 누적 0 상황에서 8hours 모드와 동일한 144,000원 산출

---

## 통과 항목 상세

### API CRUD (8/8)
- ✅ 연차 1일 등록
- ✅ 오전 반차 등록
- ✅ 같은 날 오후 반차 (다른 유형) 등록 — 충돌 없음
- ✅ 무급휴가 등록
- ✅ 경조사 등록
- ✅ 휴가 삭제 200
- ✅ 월별 조회 (5건)
- ✅ 직원별 조회 (5건) — 직원 메타(name·color·hourly_rate) 포함

### 엣지 케이스/보안 (10/10)
- ✅ **중복 등록 차단 (409)** — 버그 #1 수정 검증
- ✅ 잘못된 type 거부 (400) — 'vacation' 등 정의 외 값
- ✅ 잘못된 날짜 형식 거부 (400) — `2026/05/26` 같은 슬래시 포맷
- ✅ 필수항목(`date`) 누락 거부 (400)
- ✅ 인증 없는 POST 거부 (401)
- ✅ 인증 없는 DELETE 거부 (401)
- ✅ 타 사업장 토큰으로 등록 거부 (401)
- ✅ 타 사업장 토큰으로 삭제 거부 (401)
- ✅ 없는 휴가 ID 삭제 시 404
- ✅ 타 사업장 직원ID 지정 시 거부 (404)

### payroll 응답 신규 필드 (8/8)
- ✅ 응답에 `paid_leave_days/pay`, `unpaid_leave_days`, `sick_days`, `family_days`, `time_off` 모두 존재
- ✅ `paid_leave_days = 1.5` (연차 1.0 + 0.5 합산, 다른 유형 제외)
- ✅ `unpaid_leave_days = 1.0`
- ✅ `sick_days = 0.5`
- ✅ `family_days = 1.0`
- ✅ `paid_leave_pay = 144,000원` (시급 12,000 × 8시간 × 1.5일, 8hours 모드)
- ✅ `total_pay = 144,000원` (base_pay 0 + paid_leave_pay 144,000 + weekly_holiday 0)

### 정책 PATCH (5/5)
- ✅ `leave_pay_calc_mode` + `weekly_holiday_includes_leave` 동시 변경
- ✅ 변경 후 GET businesses 응답에 반영됨
- ✅ 잘못된 mode 값 거부 (400)
- ✅ 인증 없는 PATCH 거부 (401)
- ✅ 빈 바디 PATCH 거부 (400)

### 환산 모드 정확성 (1/1)
- ✅ **avg_workhours 모드 + 출근 0건 → 8시간 fallback 적용** — 버그 #2 수정 검증

### weekly_holiday_includes_leave 토글 (2/2)
- ✅ ON 상태에서 연차 2일(16h) 등록 → 주휴수당 38,400원 ((16/40)×8×12,000) 발생
- ✅ OFF + 출근 없음 → 주휴수당 0원

### Cascade 삭제 (2/2)
- ✅ 휴가 삭제 후 조회 시 미존재
- ✅ 직원 삭제 시 해당 직원의 모든 time_off 자동 삭제 (FK ON DELETE CASCADE)

### DB 마이그레이션 (3/3)
- ✅ 신규 DB: `businesses.leave_pay_calc_mode` 기본값 `'8hours'`, `weekly_holiday_includes_leave` 기본값 `1`
- ✅ **구 스키마(NULL 허용) → 신 스키마(NOT NULL 'full') 자동 마이그레이션** — 기존 NULL 행이 `'full'`로 안전 변환, 데이터 보존
- ✅ 마이그레이션 후에도 중복 등록 차단(409) 동작

---

## UI 수동 확인 (사용자 진행)
다음 항목은 자동 테스트 범위 밖이므로 브라우저(http://localhost:5174)에서 직접 확인 필요:
- [ ] 관리자 대시보드 — 🏖 휴가 정책 섹션 토글 동작
- [ ] 관리자 근태 탭 — 🏖 휴가 버튼 → 모달 → 등록 → 카드 표시
- [ ] 관리자 급여 탭 — 직원 카드에 "🏖 연차 N일 (금액)" 행 표시
- [ ] 직원 페이지 — "🏖 이번 달 휴가" 섹션 표시
- [ ] 모바일 화면(375px)에서 모달 UI 정상 표시
- [ ] 에러 발생 시 토스트/배너 메시지 노출

---

## 추가 검증 — 마스터 토글 (2026-05-26 추가)

`time_off_enabled` 사업장별 ON/OFF 마스터 스위치 추가에 대한 검증:

### 마스터 토글 (9/9)
- ✅ 신규 사업장 기본값 `time_off_enabled=0` (OFF)
- ✅ PATCH로 `time_off_enabled=true` 설정 가능
- ✅ PATCH로 `time_off_enabled=false` 설정 가능
- ✅ ON 상태 payroll에 `paid_leave_pay=96000`, `paid_leave_days=1.0` 반영
- ✅ OFF 토글 시 payroll 응답에서 휴가 entry 자동 제외 (출근 0이면 빈 배열 반환)
- ✅ OFF 상태에서도 GET /time-off로 데이터 보존 확인 (1건 유지)
- ✅ 다시 ON 토글하면 payroll에 즉시 복원 (`paid_leave_pay=96000`)
- ✅ `weekly_holiday_includes_leave`가 ON이어도 마스터 OFF면 무력화
- ✅ 회귀: 기존 39개 검증 모두 재통과 (사업장 생성 후 마스터 ON 켜는 단계 추가)

### 데이터 정책
- 마스터 OFF로 토글해도 기존 등록된 휴가 데이터는 **DB에 보존**
- payroll 응답·UI 표시에서만 제외
- 다시 ON으로 토글하면 즉시 복원 — 데이터 손실 없음

---

## 최종 판정
✅ **자동 테스트 48/48 통과** — 백엔드/데이터 무결성/마이그레이션/마스터 토글 검증 완료

UI 수동 확인 후 PR 머지 진행 가능. 사용자 dev 서버(http://localhost:5174) 가동 중. 신규 사업장은 **휴가 기능 기본 OFF**.
