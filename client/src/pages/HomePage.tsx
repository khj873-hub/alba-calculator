import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchEmployees } from '../api'
import { useSlug } from '../hooks/useSlug'
import type { Employee } from '../types'

export default function HomePage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const slug = useSlug()

  useEffect(() => {
    fetchEmployees(slug).then(setEmployees).finally(() => setLoading(false))
  }, [slug])

  if (loading) return <div className="text-center text-gray-400 py-20">불러오는 중...</div>

  return (
    <div>
      <p className="text-sm text-gray-500 mb-6 text-center">본인 이름을 선택하세요</p>

      {employees.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">👤</div>
          <p className="text-sm">등록된 직원이 없습니다</p>
          <p className="text-xs mt-2 text-gray-300">관리자에게 문의하세요</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {employees.map((emp) => (
            <button
              key={emp.id}
              onClick={() => navigate(`/${slug}/employee/${emp.id}`)}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4 hover:shadow-md hover:border-green-200 transition text-left w-full active:scale-[0.98]"
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-extrabold text-xl shrink-0"
                style={{ background: emp.color }}
              >
                {emp.name[0]}
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-800 text-base">{emp.name}</div>
                {emp.is_working ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-xs text-green-600 font-semibold">출근 중 · {emp.clock_in?.slice(11, 16)} 부터</span>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 mt-0.5">퇴근</div>
                )}
              </div>
              <span className="text-gray-300 text-lg">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
