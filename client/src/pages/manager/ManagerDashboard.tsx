import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchEmployees, fetchBusiness, clockIn, clockOut, deleteEmployee, setBusinessLocation, getStoredToken } from '../../api'
import { useSlug } from '../../hooks/useSlug'
import { getCurrentPosition } from '../../utils/geo'
import type { Employee, Business } from '../../types'

function formatElapsed(clockInStr: string) {
  const diff = Math.floor((Date.now() - new Date(clockInStr).getTime()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return h > 0 ? `${h}시간 ${m}분째` : `${m}분째`
}

export default function ManagerDashboard() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<number | null>(null)
  const [error, setError] = useState('')

  // 위치 설정
  const [showLocationForm, setShowLocationForm] = useState(false)
  const [locationPin, setLocationPin] = useState('')
  const [radius, setRadius] = useState(300)
  const [locationError, setLocationError] = useState('')
  const [locationSaving, setLocationSaving] = useState(false)
  const [locationStatus, setLocationStatus] = useState('')

  const navigate = useNavigate()
  const slug = useSlug()

  const load = useCallback(async () => {
    try {
      const [emps, biz] = await Promise.all([fetchEmployees(slug), fetchBusiness(slug)])
      setEmployees(emps)
      setBusiness(biz)
      if (biz.radius_meters) setRadius(biz.radius_meters)
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
            </div>
          ))}
        </div>
      )}

      {/* 위치 설정 */}
      <div className="mt-8 border-t border-gray-100 pt-6">
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
