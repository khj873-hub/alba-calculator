import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import EmployeeFormPage from './pages/manager/EmployeeFormPage'

export default function App() {
  return (
    <ManagerProvider>
      <BrowserRouter>
        <Routes>
          {/* 랜딩 */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/create" element={<CreateBusinessPage />} />
          <Route path="/businesses" element={<BusinessListPage />} />

          {/* 직원 영역 */}
          <Route element={<EmployeeLayout />}>
            <Route path="/:slug" element={<HomePage />} />
            <Route path="/:slug/employee/:id" element={<PersonalPage />} />
          </Route>

          {/* 관리자 로그인 */}
          <Route path="/:slug/manager/login" element={<PINPage />} />

          {/* 관리자 영역 */}
          <Route element={<ManagerLayout />}>
            <Route path="/:slug/manager" element={<ManagerDashboard />} />
            <Route path="/:slug/manager/attendance" element={<ManagerAttendancePage />} />
            <Route path="/:slug/manager/payroll" element={<ManagerPayrollPage />} />
            <Route path="/:slug/manager/employees/new" element={<EmployeeFormPage />} />
            <Route path="/:slug/manager/employees/:id/edit" element={<EmployeeFormPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ManagerProvider>
  )
}
