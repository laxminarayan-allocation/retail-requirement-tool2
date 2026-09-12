import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { DisplayProvider } from '@/context/DisplayContext'
import AppLayout from '@/layouts/AppLayout'
import LoginPage from '@/pages/LoginPage'
import Dashboard from '@/pages/Dashboard'
import DatabaseExplorer from '@/pages/DatabaseExplorer'
import Calculation from '@/pages/Calculation'
import Results from '@/pages/Results'
import Settings from '@/pages/Settings'
import AdminPanel from '@/pages/AdminPanel'
import UserManual from '@/pages/UserManual'
import NSODashboard from '@/pages/NSODashboard'
import SaleDashboard from '@/pages/SaleDashboard'
import ReqDashboard from '@/pages/ReqDashboard'
import DistributionModel from '@/pages/DistributionModel'
import Simulation from '@/pages/Simulation'
import OptionListing from '@/pages/OptionListing'
import PipelineScheduler from '@/pages/PipelineScheduler'
import OracleRefreshPage from '@/pages/OracleRefreshPage'
import WarehouseInventory from '@/pages/WarehouseInventory'
import { OracleRefreshProvider } from '@/context/OracleRefreshContext'
import { ZoomProvider } from '@/context/ZoomContext'

export default function App() {
  return (
    <ZoomProvider>
    <DisplayProvider>
    <ThemeProvider>
    <AuthProvider>
    <OracleRefreshProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="database" element={<DatabaseExplorer />} />
            <Route path="factors" element={<Navigate to="/calculation?tab=factors" replace />} />
            <Route path="calculation" element={<Calculation />} />
            <Route path="results" element={<Navigate to="/simulation?tab=results" replace />} />
            <Route path="history" element={<Navigate to="/simulation?tab=results&tab2=history" replace />} />
            <Route path="settings" element={<Settings />} />
            <Route path="admin" element={<AdminPanel />} />
            <Route path="manual" element={<UserManual />} />
            <Route path="procedures" element={<Navigate to="/settings?tab=procedures" replace />} />
            <Route path="nso" element={<NSODashboard />} />
            <Route path="warehouse" element={<WarehouseInventory />} />
            <Route path="sale" element={<SaleDashboard />} />
            <Route path="req" element={<ReqDashboard />} />
            <Route path="distribution" element={<DistributionModel />} />
            <Route path="simulation" element={<Navigate to="/calculation?tab=simulation" replace />} />
            <Route path="option-listing" element={<OptionListing />} />
            <Route path="pipeline-scheduler" element={<PipelineScheduler />} />
            <Route path="oracle-refresh" element={<OracleRefreshPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </OracleRefreshProvider>
    </AuthProvider>
    </ThemeProvider>
    </DisplayProvider>
    </ZoomProvider>
  )
}
