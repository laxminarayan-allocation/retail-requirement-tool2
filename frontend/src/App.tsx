import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import AppLayout from '@/layouts/AppLayout'
import LoginPage from '@/pages/LoginPage'
import Dashboard from '@/pages/Dashboard'
import DatabaseExplorer from '@/pages/DatabaseExplorer'
import MasterData from '@/pages/MasterData'
import Factors from '@/pages/Factors'
import Calculation from '@/pages/Calculation'
import History from '@/pages/History'
import Results from '@/pages/Results'
import Settings from '@/pages/Settings'
import AdminPanel from '@/pages/AdminPanel'
import UserManual from '@/pages/UserManual'
import Procedures from '@/pages/Procedures'
import NSODashboard from '@/pages/NSODashboard'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="database" element={<DatabaseExplorer />} />
            <Route path="master-data" element={<MasterData />} />
            <Route path="factors" element={<Factors />} />
            <Route path="calculation" element={<Calculation />} />
            <Route path="results" element={<Results />} />
            <Route path="history" element={<History />} />
            <Route path="settings" element={<Settings />} />
            <Route path="admin" element={<AdminPanel />} />
            <Route path="manual" element={<UserManual />} />
            <Route path="procedures" element={<Procedures />} />
            <Route path="nso" element={<NSODashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
