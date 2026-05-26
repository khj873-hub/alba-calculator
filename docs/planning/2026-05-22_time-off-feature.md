# 연차 기능 기획안 v2 (확정)

- **작성일 (v1)**: 2026-05-22
- **확정일 (v2)**: 2026-05-26
- **상태**: ✅ 확정 — P0 구현 진행
- **이전 트리거 문구**: "퍼펙트 근태관리 연차 기능 진행해줘"

---

## 1. 목적
출/퇴근 기록만 있어 **연차 사용일과 결근/지각이 구분되지 않음**.
사장 입장에서 급여 계산 시 "왜 이날 안 찍었지?"를 매번 물어야 함.
연차를 별도 기록으로 남겨 ① 급여 계산 정확도 ② 직원별 휴가 사용 추적 ③ 명세서 명확성 확보.

## 2. 확정된 정책 (v1 → v2)

| 항목 | v2 확정안 | 변경 사유 |
|---|---|---|
| **마스터 사용 ON/OFF** | **사업장별 토글, 기본 OFF** | 연봉제 등 휴가 환산 불필요한 사업장 배려 (2026-05-26 추가) |
| 유형 구분 | **4종** — 연차 · 무급휴가 · 병가 · 경조사 | v1 추천 그대로 채택 |
| 단위 | **1일 + 반차(0.5일)** | v1 추천 그대로 채택 |
| 유급 연차 1일 환산 | **사업장별 선택 가능** — `시급×8시간` / `평일 평균 근무시간` | 시급제·시급변동 사업장 모두 대응 |
| 잔여 연차 관리 | **수동 입력(P0) → 자동 적립(P1)** | v1 추천 그대로 채택 |
| 주휴수당 영향 | **사업장별 설정** — 연차일 주 15시간 카운트 포함/제외 토글 | 사업장별 운영 정책 차이 반영 |
| 입력 주체 | **사장만 입력 (영구)** | 직원 신청 플로우는 만들지 않음 |

## 3. 사용자 시나리오

### A. 사장이 연차 등록
1. 관리자 → 근태 탭 → 특정 날짜 클릭 → "+ 휴가 추가" 버튼
2. 직원 선택 → 유형(연차/무급/병가/경조사) → 1일 / 오전반차 / 오후반차 → 메모(선택)
3. 저장 → 해당 날짜에 🏖 아이콘 표시, 급여 탭 자동 반영

### B. 직원이 본인 휴가 확인
- 직원 페이지 → "최근 출퇴근 기록" 위에 🏖 휴가 사용 내역 섹션
- 이번 달 사용한 휴가 유형별 카운트 표시

### C. 급여 계산 시
- 급여 탭 직원 카드에 "유급 연차 1.5일 (108,000원)" 라벨
- PDF/CSV 명세서: "근무 N일 / 유급 연차 N일 / 무급휴가 N일"

## 4. 화면 변경

| 화면 | 변경 |
|---|---|
| 관리자 근태 탭 | 날짜 헤더에 🏖 표시, "+ 휴가 추가" 버튼 + 모달 |
| 관리자 대시보드 | 설정 섹션에 "휴가 정책" 토글 2개 (환산 모드 / 주휴 포함 여부) |
| 관리자 급여 탭 | 직원 카드에 "유급 연차 N일 (금액)" 행 + 총 지급액 합산 |
| 직원 개인 페이지 | 월 통계에 "🏖 휴가 N일", 기록 섹션에 휴가 행 |
| PDF/CSV 급여명세서 | 지급내역에 "유급 연차" 행 + 근무 상세에 휴가 행 |

## 5. DB / API

### 신규 테이블 `time_off`
```sql
CREATE TABLE time_off (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,                    -- YYYY-MM-DD
  type          TEXT NOT NULL,                    -- 'annual'|'unpaid'|'sick'|'family'
  portion       REAL NOT NULL DEFAULT 1.0,        -- 1.0 / 0.5
  half_period   TEXT,                             -- 'am'|'pm' (portion=0.5일 때만)
  memo          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(employee_id, date, half_period)
);
CREATE INDEX idx_timeoff_emp_date ON time_off(employee_id, date);
```

### businesses 신규 컬럼 3개
```sql
ALTER TABLE businesses ADD COLUMN time_off_enabled INTEGER NOT NULL DEFAULT 0;
  -- 마스터 스위치 (기본 OFF). OFF면 UI에서 휴가 관련 섹션 숨김
  -- payroll 응답에서 휴가 데이터 무시 (데이터는 보존)
ALTER TABLE businesses ADD COLUMN leave_pay_calc_mode TEXT NOT NULL DEFAULT '8hours';
  -- '8hours' | 'avg_workhours' (time_off_enabled=1일 때만 적용)
ALTER TABLE businesses ADD COLUMN weekly_holiday_includes_leave INTEGER NOT NULL DEFAULT 1;
  -- 1: 주휴수당 계산 시 연차일도 주 15시간 카운트에 포함
  -- 0: 제외
  -- time_off_enabled=0이면 자동 무력화
```

### 신규 API
- `GET    /api/:slug/time-off?year&month[&employee_id]` — 월별 휴가 조회
- `POST   /api/:slug/time-off` (관리자) — `{ employee_id, date, type, portion, half_period?, memo? }`
- `DELETE /api/:slug/time-off/:id` (관리자) — 삭제
- `PATCH  /api/businesses/:slug/leave-policy` (관리자 세션) — `{ time_off_enabled?, leave_pay_calc_mode?, weekly_holiday_includes_leave? }`

### 기존 응답 확장
- `GET /api/businesses/:slug` 응답에 `leave_pay_calc_mode`, `weekly_holiday_includes_leave` 포함
- `GET /api/:slug/payroll` 응답에 다음 필드 추가:
  - `paid_leave_days` (number) — 유급 연차 일수 (반차 합산)
  - `paid_leave_pay` (number) — 유급 연차 환산 금액
  - `unpaid_leave_days` (number) — 무급 휴가 일수
  - `sick_days` (number), `family_days` (number)
  - 기존 `total_pay`는 `base_pay + weekly_holiday_pay + paid_leave_pay`로 변경

### payroll 계산 로직 변경
1. 기존: `total_minutes`에서 시급 환산 → `base_pay`
2. 신규: 사업장 `leave_pay_calc_mode` 조회
   - `8hours`: `paid_leave_days × 8 × hourly_rate`
   - `avg_workhours`: 해당 직원의 그달 평일 평균 근무시간(분) × `paid_leave_days × hourly_rate / 60`
3. 주휴수당 계산 시 `weekly_holiday_includes_leave=1`이면 연차일 환산 분(`paid_leave_days × 8 × 60`)을 주별 minutes에 합산해서 15시간 임계 판정

## 6. P0 구현 범위 (이번 작업)
- [x] DB 마이그레이션 (`time_off` 테이블 + businesses 신규 컬럼 2개)
- [x] time-off CRUD API 3개
- [x] businesses leave-policy PATCH API
- [x] payroll 응답 확장 + 환산 로직
- [x] 관리자 근태 탭 휴가 등록 UI (날짜 클릭 → 모달)
- [x] 관리자 대시보드 휴가 정책 설정 UI
- [x] 직원 페이지 휴가 표시 섹션

## 7. P1 (다음 작업)
- 잔여 연차 자동 적립 (입사일 기반, 근속 1년=15일)
- PDF/CSV 명세서 항목 추가 (유급 연차 행)
- 캘린더 뷰
- 출근 기록 있는 날 연차 등록 차단/경고 UI

## 8. P2
- 공휴일 미리 등록 / 자동 알림
- 퇴직자 연차 정산

## 9. 리스크 / 운영 결정 사항
- **이미 출근 기록 있는 날에 연차 등록** — P0에선 허용(데이터 정합성 책임은 사장). P1에서 차단 + 경고 추가
- **반차 + 부분 출근** — 반차 0.5 + 출근 시간 합산은 자유. UI상 둘 다 표시
- **퇴직자 연차 정산** — P2 이후

---
