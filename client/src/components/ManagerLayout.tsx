import { Outlet, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { useManager } from '../context/ManagerContext'
import { useSlug } from '../hooks/useSlug'

export default function ManagerLayout() {
  const { isAuth, logout } = useManager()
  const navigate = useNavigate()
  const slug = useSlug()

  if (!isAuth(slug)) return <Navigate to={`/${slug}/manager/login`} replace />

  const nav = [
    { to: `/${slug}/manager`, label: '직원', icon: '👥', end: true },
    { to: `/${slug}/manager/attendance`, label: '근태', icon: '📋' },
    { to: `/${slug}/manager/report`, label: '리포트', icon: '📊' },
    { to: `/${slug}/manager/payroll`, label: '급여', icon: '💰' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-lg mx-auto">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-extrabold text-blue-600">🔐 관리자</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">퍼펙트 근태관리</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/${slug}`)}
            className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 transition"
          >
            직원 화면
          </button>
          <button
            onClick={() => { logout(slug); navigate('/') }}
            className="text-xs text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg border border-red-100 hover:border-red-200 transition"
          >
            로그아웃
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 mx-auto w-full max-w-lg bg-white border-t border-gray-100 flex">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-3 text-xs font-semibold transition ${
                isActive ? 'text-blue-600' : 'text-gray-400'
              }`
            }
          >
            <span className="text-xl mb-0.5">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
