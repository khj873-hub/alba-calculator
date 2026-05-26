import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchEmployees, fetchBusiness, clockIn, clockOut, deleteEmployee, setBusinessLocation, getStoredToken,
  regenerateEmployeeToken, buildEmployeeLink, updateHomeMode, updateLeavePolicy,
} from '../../api'
import { useSlug } from '../../hooks/useSlug'
import { getCurrentPosition } from '../../utils/geo'
import type { Employee, Business, HomeMode, LeavePayCalcMode } from '../../types'

function formatElapsed(clockInStr: string) {
  const diff = Math.floor((Date.now() - new Date(clockInStr).getTime()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return h > 0 ? `${h}시간 ${m}분째` : `${m}분째`
}

export default function ManagerDashboard() {
  const navigate = useNavigate()
  const slug = useSlug()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [homeMode, setHomeModeState] = useState<HomeMode>('kiosk')
  const [homeModeSaving, setHomeModeSaving] = useState(false)
  const [showHomeModeForm, setShowHomeModeForm] = useState(false)

  // 휴가 정책
  const [timeOffEnabled, setTimeOffEnabled] = useState<boolean>(false)
  const [leaveMode, setLeaveMode] = useState<LeavePayCalcMode>('8hours')
  const [includeLeaveInWeekly, setIncludeLeaveInWeekly] = useState<boolean>(true)
  const [leavePolicySaving, setLeavePolicySaving] = useState(false)
  const [showLeavePolicyForm, setShowLeavePolicyForm] = useState(false)

  // 위치 설정
  const [showLocationForm, setShowLocationForm] = useState(false)
  const [locationPin, setLocationPin] = useState('')
  const [radius, setRadius] = useState(300)
  const [locationError, setLocationError] = useState('')
  const [locationSaving, setLocationSaving] = useState(false)
  const [locationStatus, setLocationStatus] = useState('')

  const load = useCallback(async () => {
    try {
      const [emps, biz] = await Promise.all([fetchEmployees(slug), fetchBusiness(slug)])
      setEmployees(emps)
      setBusiness(biz)
      setHomeModeState(biz.home_mode === 'private' ? 'private' : 'kiosk')
      if (biz.radius_meters) setRadius(biz.radius_meters)
      setTimeOffEnabled((biz.time_off_enabled ?? 0) === 1)
      setLeaveMode(biz.leave_pay_calc_mode === 'avg_workhours' ? 'avg_workhours' : '8hours')
      setIncludeLeaveInWeekly((biz.weekly_holiday_includes_leave ?? 1) === 1)
    } finally { setLoading(false) }
  }, [slug])

  useEffect(() => { load() }, [load])

  // 관리자 출퇴근: PIN 헤더로 위치 우회
  const handleClock = async (emp: Employee) => {
    setActionId(emp.id); setError('')
    try {
      const token = getStoredToken(slug)
      if (emp.is_working) await clockOut(slug, emp.id, undefined, token)
      else await clockIn(slug, emp.id, undefined, token)
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setActionId(null) }
  }

  const handleDelete = async (emp: Employee) => {
    if (!confirm(`${emp.name} 직원을 삭제하시겠어요? 모든 근태 기록도 삭제됩니다.`)) return
    try { await deleteEmployee(slug, emp.id); await load() }
    catch (e: any) { setError(e.message) }
  }

  const handleCopyLink = async (emp: Employee) => {
    const link = buildEmployeeLink(slug, emp.access_token)
    try {
      await navigator.clipboard.writeText(link)
      setCopiedId(emp.id)
      setTimeout(() => setCopiedId(c => (c === emp.id ? null : c)), 1500)
    } catch {
      window.prompt('링크 복사가 차단됐어요. 직접 복사하세요:', link)
    }
  }

  const handleRegenerate = async (emp: Employee) => {
    if (!confirm(`${emp.name}의 출근 링크를 새로 발급할까요? 기존 링크는 더 이상 작동하지 않습니다.`)) return
    try {
      await regenerateEmployeeToken(slug, emp.id)
      await load()
    } catch (e: any) { setError(e.message) }
  }

  const handleToggleTimeOffEnabled = async () => {
    if (leavePolicySaving) return
    setLeavePolicySaving(true); setError('')
    const next = !timeOffEnabled
    try {
      await updateLeavePolicy(slug, { time_off_enabled: next })
      setTimeOffEnabled(next)
    } catch (e: any) { setError(e.message) }
    finally { setLeavePolicySaving(false) }
  }

  const handleSetLeaveMode = async (mode: LeavePayCalcMode) => {
    if (mode === leaveMode || leavePolicySaving) return
    setLeavePolicySaving(true); setError('')
    try {
      await updateLeavePolicy(slug, { leave_pay_calc_mode: mode })
      setLeaveMode(mode)
    } catch (e: any) { setError(e.message) }
    finally { setLeavePolicySaving(false) }
  }

  const handleToggleIncludeLeave = async () => {
    if (leavePolicySaving) return
    setLeavePolicySaving(true); setError('')
    const next = !includeLeaveInWeekly
    try {
      await updateLeavePolicy(slug, { weekly_holiday_includes_leave: next })
      setIncludeLeaveInWeekly(next)
    } catch (e: any) { setError(e.message) }
    finally { setLeavePolicySaving(false) }
  }

  const handleSwitchHomeMode = async (mode: HomeMode) => {
    if (mode === homeMode || homeModeSaving) return
    setHomeModeSaving(true); setError('')
    try {
      await updateHomeMode(slug, mode)
      setHomeModeState(mode)
    } catch (e: any) { setError(e.message) }
    finally { setHomeModeSaving(false) }
  }

  const handleSetLocation = async () => {
    if (!locationPin) { setLocationError('PIN을 입력하세요'); return }
    setLocationSaving(true); setLocationError(''); setLocationStatus('📍 현재 위치 가져오는 중...')
    try {
      const coords = await getCurrentPosition()
      setLocationStatus('저장 중...')
      await setBusinessLocation(slug, { pin: locationPin, lat: coords.lat, lng: coords.lng, radius_meters: radius })
      await load()
      setShowLocationForm(false)
      setLocationPin('')
      setLocationStatus('')
    } catch (e: any) { setLocationError(e.message); setLocationStatus('') }
    finally { setLocationSaving(false) }
  }

  const handleClearLocation = async () => {
    if (!locationPin) { setLocationError('PIN을 입력하세요'); return }
    setLocationSaving(true); setLocationError('')
    try {
      await setBusinessLocation(slug, { pin: locationPin, lat: null, lng: null, radius_meters: 300 })
      await load()
      setShowLocationForm(false)
      setLocationPin('')
    } catch (e: any) { setLocationError(e.message) }
    finally { setLocationSaving(false) }
  }

  if (loading) return <div className="text-center text-gray-400 py-20">불러오는 중...</div>

  const working = employees.filter(e => e.is_working)
  const hasLocation = !!(business?.lat && business?.lng)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-extrabold text-gray-800">직원 관리</h2>
          {working.length > 0 && (
            <p className="text-xs text-green-600 font-semibold mt-0.5">출근 중 {working.length}명</p>
          )}
        </div>
        <button
          onClick={() => navigate(`/${slug}/manager/employees/new`)}
          className="bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-blue-700 transition"
        >
          + 직원 추가
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}

      {employees.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">👤</div>
          <p className="text-sm">직원을 추가해보세요</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {employees.map((emp) => (
            <div key={emp.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-extrabold text-lg shrink-0"
                  style={{ background: emp.color }}>
                  {emp.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-gray-800">{emp.name}</div>
                  <div className="text-xs text-gray-400">시급 {emp.hourly_rate.toLocaleString()}원</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => navigate(`/${slug}/manager/employees/${emp.id}/edit`)}
                    className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50 transition text-sm">✏️</button>
                  <button onClick={() => handleDelete(emp)}
                    className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition text-sm">🗑</button>
                </div>
              </div>

              {emp.is_working && emp.clock_in && (
                <div className="bg-green-50 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0"></span>
                  <span className="text-xs text-green-700 font-semibold">
                    {emp.clock_in.slice(11, 16)} 출근 · {formatElapsed(emp.clock_in)} 근무 중
                  </span>
                </div>
              )}

              <button
                onClick={() => handleClock(emp)}
                disabled={actionId === emp.id}
                className={`w-full py-3 rounded-xl font-bold text-sm transition ${
                  emp.is_working ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-green-500 text-white hover:bg-green-600'
                } disabled:opacity-50`}
              >
                {actionId === emp.id ? '처리 중...' : emp.is_working ? '퇴근 처리 🔴' : '출근 처리 🟢'}
              </button>

              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                <button
                  onClick={() => handleCopyLink(emp)}
                  className="flex-1 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-2 transition"
                  title={buildEmployeeLink(slug, emp.access_token)}
                >
                  {copiedId === emp.id ? '✓ 복사 완료' : '🔗 출근 링크 복사'}
                </button>
                <button
                  onClick={() => handleRegenerate(emp)}
                  className="text-xs font-semibold text-gray-500 hover:text-red-500 bg-gray-50 hover:bg-red-50 rounded-lg px-3 py-2 transition"
                  title="링크 재발급 (기존 링크 무효화)"
                >
                  🔄
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 휴가 정책 */}
      <div className="mt-8 border-t border-gray-100 pt-6">
        <button
          onClick={() => setShowLeavePolicyForm(v => !v)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 font-semibold transition w-full"
        >
          <span>🏖 휴가 정책</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ml-1 ${timeOffEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
            {timeOffEnabled ? `사용 · ${leaveMode === '8hours' ? '8시간 환산' : '평균 환산'}` : '미사용'}
          </span>
          <span className="ml-auto">{showLeavePolicyForm ? '▲' : '▼'}</span>
        </button>

        {showLeavePolicyForm && (
          <div className="mt-4 bg-gray-50 rounded-2xl p-4 flex flex-col gap-4">
            {/* 마스터 토글 */}
            <button
              onClick={handleToggleTimeOffEnabled}
              disabled={leavePolicySaving}
              className={`text-left rounded-xl p-3 border-2 transition ${
                timeOffEnabled ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'
              } disabled:opacity-50`}
            >
              <div className="flex items-center justify-between">
                <div className="font-bold text-sm text-gray-800">
                  휴가 관리 사용
                </div>
                <span className={`w-10 h-5 rounded-full relative transition-colors ${timeOffEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${timeOffEnabled ? 'left-5' : 'left-0.5'}`} />
                </span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed mt-1">
                연차·반차·병가·경조사 등록 기능 사용 여부. 연봉제나 휴가 계산이 필요 없는 사업장은 OFF.
              </p>
            </button>

            {timeOffEnabled && (
              <>
                <div className="border-t border-gray-200 pt-3">
                  <div className="text-xs font-semibold text-gray-500 mb-2">유급 연차 1일 환산 방식</div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleSetLeaveMode('8hours')}
                      disabled={leavePolicySaving}
                      className={`text-left rounded-xl p-3 border-2 transition ${
                        leaveMode === '8hours' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'
                      } disabled:opacity-50`}
                    >
                      <div className="font-bold text-sm text-gray-800 mb-1">
                        {leaveMode === '8hours' && '✓ '}시급 × 8시간 (근로기준법 기본)
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">
                        연차 1일 = 시급의 8배. 시급 12,000원 → 1일 96,000원
                      </p>
                    </button>
                    <button
                      onClick={() => handleSetLeaveMode('avg_workhours')}
                      disabled={leavePolicySaving}
                      className={`text-left rounded-xl p-3 border-2 transition ${
                        leaveMode === 'avg_workhours' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'
                      } disabled:opacity-50`}
                    >
                      <div className="font-bold text-sm text-gray-800 mb-1">
                        {leaveMode === 'avg_workhours' && '✓ '}평일 평균 근무시간
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">
                        해당 직원의 이번 달 평균 근무시간 × 시급. 짧게 일하는 직원에게 합리적.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-3">
                  <div className="text-xs font-semibold text-gray-500 mb-2">주휴수당 15시간 카운트</div>
                  <button
                    onClick={handleToggleIncludeLeave}
                    disabled={leavePolicySaving}
                    className={`w-full text-left rounded-xl p-3 border-2 transition ${
                      includeLeaveInWeekly ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'
                    } disabled:opacity-50`}
                  >
                    <div className="font-bold text-sm text-gray-800 mb-1">
                      연차 사용일을 주 15시간 카운트에 {includeLeaveInWeekly ? '포함 ✓' : '제외'}
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      ON: 근로기준법 기본 (연차일도 일한 것으로 간주) / OFF: 실제 근무일만 카운트
                    </p>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 홈 화면 모드 */}
      <div className="mt-6 border-t border-gray-100 pt-6">
        <button
          onClick={() => setShowHomeModeForm(v => !v)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 font-semibold transition w-full"
        >
          <span>🏠 직원 홈 화면 모드</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ml-1 ${homeMode === 'kiosk' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
            {homeMode === 'kiosk' ? '키오스크' : '개인 링크'}
          </span>
          <span className="ml-auto">{showHomeModeForm ? '▲' : '▼'}</span>
        </button>

        {showHomeModeForm && (
          <div className="mt-4 bg-gray-50 rounded-2xl p-4 flex flex-col gap-3">
            <p className="text-xs text-gray-500">
              사업장 홈 화면(<code className="text-[10px] bg-gray-200 px-1 rounded">/{slug}</code>) 진입 시 보일 화면을 선택하세요.
            </p>
            <button
              onClick={() => handleSwitchHomeMode('kiosk')}
              className={`text-left rounded-xl p-3 border-2 transition ${
                homeMode === 'kiosk' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="font-bold text-sm text-gray-800 mb-1">
                {homeMode === 'kiosk' && '✓ '}🖥 키오스크 모드
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                직원 카드가 한 화면에 모두 노출됩니다. 매장 공용 단말 1대로 모든 직원이 출퇴근 찍는 경우.
              </p>
            </button>
            <button
              onClick={() => handleSwitchHomeMode('private')}
              className={`text-left rounded-xl p-3 border-2 transition ${
                homeMode === 'private' ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="font-bold text-sm text-gray-800 mb-1">
                {homeMode === 'private' && '✓ '}🔗 개인 링크 모드
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                직원별 고유 링크로만 본인 페이지 접근 가능. 각자 본인 휴대폰으로 출퇴근 찍는 경우. 위 직원 카드의 "🔗 출근 링크 복사"로 직원에게 전달.
              </p>
            </button>
          </div>
        )}
      </div>

      {/* 위치 설정 */}
      <div className="mt-6 border-t border-gray-100 pt-6">
        <button
          onClick={() => { setShowLocationForm(v => !v); setLocationError(''); setLocationPin('') }}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 font-semibold transition w-full"
        >
          <span>📍 출퇴근 위치 제한</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ml-1 ${hasLocation ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
            {hasLocation ? `ON · 반경 ${business?.radius_meters}m` : 'OFF'}
          </span>
          <span className="ml-auto">{showLocationForm ? '▲' : '▼'}</span>
        </button>

        {showLocationForm && (
          <div className="mt-4 bg-gray-50 rounded-2xl p-4 flex flex-col gap-3">
            {hasLocation && (
              <div className="bg-green-50 rounded-xl px-3 py-2 text-xs text-green-700 font-semibold">
                현재 위치 설정됨 · 반경 {business?.radius_meters}m 이내만 출퇴근 가능
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">허용 반경 (m)</label>
              <input type="number" value={radius} onChange={e => setRadius(Number(e.target.value))} min={10} max={5000}
                className="w-full border border-gray-200 bg-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
              <p className="text-xs text-gray-400 mt-1">권장: 실외 100m · 실내(GPS 오차 고려) 200~300m</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">관리자 PIN</label>
              <input type="password" value={locationPin} onChange={e => setLocationPin(e.target.value)}
                placeholder="PIN 입력" inputMode="numeric"
                className="w-full border border-gray-200 bg-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
            </div>

            {locationStatus && <p className="text-xs text-blue-500 font-semibold">{locationStatus}</p>}
            {locationError && <p className="text-red-500 text-xs">{locationError}</p>}

            <button onClick={handleSetLocation} disabled={locationSaving}
              className="w-full py-3 rounded-xl bg-green-500 text-white font-bold text-sm hover:bg-green-600 transition disabled:opacity-50">
              {locationSaving ? '설정 중...' : '📍 현재 위치로 설정'}
            </button>

            {hasLocation && (
              <button onClick={handleClearLocation} disabled={locationSaving}
                className="w-full py-3 rounded-xl border border-red-200 text-red-500 font-semibold text-sm hover:bg-red-50 transition disabled:opacity-50">
                위치 제한 해제
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
