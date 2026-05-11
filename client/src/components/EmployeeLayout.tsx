import { Outlet, useNavigate } from 'react-router-dom'
import { useSlug } from '../hooks/useSlug'

export default function EmployeeLayout() {
  const navigate = useNavigate()
  const slug = useSlug()
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-lg mx-auto">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10 flex items-center justify-between">
        <h1 className="text-lg font-extrabold text-green-600">⏱ 급여 계산기</h1>
        <button
          onClick={() => navigate(`/${slug}/manager/login`)}
          className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 transition"
        >
          관리자
        </button>
      </header>
      <main className="flex-1 px-4 py-4">
        <Outlet />
      </main>
    </div>
  )
}
