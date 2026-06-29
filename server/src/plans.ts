// 요금제 정의 — 활성(재직) 인원 한도. maxActiveEmployees: null = 무제한.
// 인원수·가격은 시장조사 후 확정 예정. 기획: docs/planning/2026-06-20_pricing-active-headcount.md
// ⚠️ free 한도는 잠정값(placeholder) — 비즈니스 확정 시 이 한 곳만 바꾸면 됨.
export interface PlanFeatures {
  notifications: boolean   // 출퇴근 SMS/카카오 알림톡 — 발송 비용 발생, 유료 전용
  gps: boolean             // GPS 위치 기반 출근 제한
  payslipExport: boolean   // 급여명세서 PDF/CSV 출력
  departments: boolean     // 부서 그룹(키오스크 조직 단위 관리) — 엔터프라이즈 전용
  attendanceReport: boolean // 근무 스케줄 + 지각/조퇴/결근 리포트 — 베이직 이상
  bulkImport: boolean      // 직원 CSV 일괄 등록 — 엔터프라이즈 전용
}

export interface PlanDef {
  key: string
  label: string
  maxActiveEmployees: number | null // null = 무제한
  monthlyPrice: number | null       // 원/월. null = 별도 문의
  features: PlanFeatures
}

// 요금제 4단계. plan 컬럼은 TEXT(앱 레이어 검증)라 키 확장 자유.
// 'paid'는 과거 2단계 시절 레거시 — 무제한으로 호환 유지(신규 부여 금지).
export const PLANS: Record<string, PlanDef> = {
  free:       { key: 'free',       label: '무료',         maxActiveEmployees: 3,    monthlyPrice: 0,     features: { notifications: false, gps: false, payslipExport: false, departments: false, attendanceReport: false, bulkImport: false } },
  basic:      { key: 'basic',      label: '베이직',       maxActiveEmployees: 5,    monthlyPrice: 9900,  features: { notifications: true,  gps: true,  payslipExport: true,  departments: false, attendanceReport: true,  bulkImport: false } },
  pro:        { key: 'pro',        label: '프로',         maxActiveEmployees: 20,   monthlyPrice: 29900, features: { notifications: true,  gps: true,  payslipExport: true,  departments: false, attendanceReport: true,  bulkImport: false } },
  enterprise: { key: 'enterprise', label: '엔터프라이즈', maxActiveEmployees: null, monthlyPrice: null,  features: { notifications: true,  gps: true,  payslipExport: true,  departments: true,  attendanceReport: true,  bulkImport: true } },
  paid:       { key: 'paid',       label: '유료(레거시)', maxActiveEmployees: null, monthlyPrice: null,  features: { notifications: true,  gps: true,  payslipExport: true,  departments: true,  attendanceReport: true,  bulkImport: true } },
}

// 운영자가 부여 가능한 플랜(레거시 paid 제외)
export const ASSIGNABLE_PLANS = ['free', 'basic', 'pro', 'enterprise']

// 플랜이 특정 기능을 허용하는지
export function planAllows(plan: string | null | undefined, feature: keyof PlanFeatures): boolean {
  return !!getPlan(plan).features[feature]
}

export function getPlan(plan?: string | null): PlanDef {
  return PLANS[plan ?? 'free'] ?? PLANS.free
}

// 활성 인원 한도 (null = 무제한)
export function activeLimit(plan?: string | null): number | null {
  return getPlan(plan).maxActiveEmployees
}
