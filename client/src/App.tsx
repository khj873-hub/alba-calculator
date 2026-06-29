import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { ManagerProvider } from './context/ManagerContext'
import EmployeeLayout from './components/EmployeeLayout'
import ManagerLayout from './components/ManagerLayout'
import LandingPage from './pages/LandingPage'
import CreateBusinessPage from './pages/CreateBusinessPage'
import BusinessListPage from './pages/BusinessListPage'
import HomePage from './pages/HomePage'
import PersonalPage from './pages/PersonalPage'
import PINPage from './pages/PINPage'
import ManagerDashboard from './pages/manager/ManagerDashboard'
import ManagerAttendancePage from './pages/manager/ManagerAttendancePage'
import ManagerPayrollPage from './pages/manager/ManagerPayrollPage'
import ManagerReportPage from './pages/manager/ManagerReportPage'
import EmployeeFormPage from './pages/manager/EmployeeFormPage'
import AdminPage from './pages/AdminPage'
import LegalPage from './pages/LegalPage'

// 경로 이동 시 스크롤을 맨 위로 (SPA는 기본적으로 위치 유지)
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

export default function App() {
  return (
    <ManagerProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          {/* 랜딩 */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/create" element={<CreateBusinessPage />} />
          <Route path="/businesses" element={<BusinessListPage />} />

          {/* 운영자 콘솔 */}
          <Route path="/admin" element={<AdminPage />} />

          {/* 법적 문서 */}
          <Route path="/legal/:doc" element={<LegalPage />} />

          {/* 직원 영역 — 사업장 home_mode에 따라 키오스크/개인 링크 모드 */}
          <Route element={<EmployeeLayout />}>
            <Route path="/:slug" element={<HomePage />} />
            <Route path="/:slug/employee/:id" element={<PersonalPage />} />
            <Route path="/:slug/e/:token" element={<PersonalPage />} />
          </Route>

          {/* 관리자 로그인 */}
          <Route path="/:slug/manager/login" element={<PINPage />} />

          {/* 관리자 영역 */}
          <Route element={<ManagerLayout />}>
            <Route path="/:slug/manager" element={<ManagerDashboard />} />
            <Route path="/:slug/manager/attendance" element={<ManagerAttendancePage />} />
            <Route path="/:slug/manager/payroll" element={<ManagerPayrollPage />} />
            <Route path="/:slug/manager/report" element={<ManagerReportPage />} />
            <Route path="/:slug/manager/employees/new" element={<EmployeeFormPage />} />
            <Route path="/:slug/manager/employees/:id/edit" element={<EmployeeFormPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ManagerProvider>
  )
}
