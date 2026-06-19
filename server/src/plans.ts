// 요금제 정의 — 활성(재직) 인원 한도. maxActiveEmployees: null = 무제한.
// 인원수·가격은 시장조사 후 확정 예정. 기획: docs/planning/2026-06-20_pricing-active-headcount.md
// ⚠️ free 한도는 잠정값(placeholder) — 비즈니스 확정 시 이 한 곳만 바꾸면 됨.
export interface PlanDef {
  key: string
  label: string
  maxActiveEmployees: number | null
}

export const PLANS: Record<string, PlanDef> = {
  free: { key: 'free', label: '무료', maxActiveEmployees: 3 },
  paid: { key: 'paid', label: '유료', maxActiveEmployees: null },
}

export function getPlan(plan?: string | null): PlanDef {
  return PLANS[plan ?? 'free'] ?? PLANS.free
}

// 활성 인원 한도 (null = 무제한)
export function activeLimit(plan?: string | null): number | null {
  return getPlan(plan).maxActiveEmployees
}
