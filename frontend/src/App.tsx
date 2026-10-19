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
import SaleWeekly from '@/pages/SaleWeekly'
import ReqDashboard from '@/pages/ReqDashboard'
import DistributionModel from '@/pages/DistributionModel'
import OptionListing from '@/pages/OptionListing'
import OracleRefreshPage from '@/pages/OracleRefreshPage'
import WarehouseInventory from '@/pages/WarehouseInventory'
import DataStore from '@/pages/DataStore'
import SourceViewer from '@/pages/SourceViewer'
import AllocationPipeline from '@/pages/AllocationPipeline'
import FlowDocumentation from '@/pages/FlowDocumentation'
import SchemaMap from '@/pages/SchemaMap'
import AllParameters from '@/pages/AllParameters'
import PrdSwap from '@/pages/PrdSwap'
import ResultsJourney from '@/pages/ResultsJourney'
import RunLogs from '@/pages/RunLogs'
import DeployAgent from '@/pages/DeployAgent'
import MyProfile from '@/pages/MyProfile'
import { OracleRefreshProvider } from '@/context/OracleRefreshContext'
import { DbRefreshProvider } from '@/context/DbRefreshContext'
import { ZoomProvider } from '@/context/ZoomContext'

export default function App() {
  return (
    <ZoomProvider>
    <DisplayProvider>
    <ThemeProvider>
    <AuthProvider>
    <DbRefreshProvider>
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
            <Route path="sale-weekly" element={<SaleWeekly />} />
            <Route path="req" element={<ReqDashboard />} />
            <Route path="distribution" element={<DistributionModel />} />
            <Route path="simulation" element={<Navigate to="/calculation?tab=simulation" replace />} />
            <Route path="option-listing" element={<OptionListing />} />
            <Route path="oracle-refresh" element={<OracleRefreshPage />} />
            <Route path="data-store" element={<DataStore />} />
            <Route path="source" element={<SourceViewer />} />
            <Route path="allocation-pipeline" element={<AllocationPipeline />} />
            <Route path="flow-docs" element={<FlowDocumentation />} />
            <Route path="schema-map" element={<SchemaMap />} />
            <Route path="all-parameters" element={<AllParameters />} />
            <Route path="prd-swap" element={<PrdSwap />} />
            <Route path="results-journey" element={<ResultsJourney />} />
            <Route path="run-logs" element={<RunLogs />} />
            <Route path="run-deploy" element={<DeployAgent />} />
            <Route path="my-profile" element={<MyProfile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </OracleRefreshProvider>
    </DbRefreshProvider>
    </AuthProvider>
    </ThemeProvider>
    </DisplayProvider>
    </ZoomProvider>
  )
}
