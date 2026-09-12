import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { MorePage } from './layout/MorePage'
import { RequireAuth } from './RequireAuth'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { TripsPage } from '@/features/trips/TripsPage'
import { VehiclesPage } from '@/features/vehicles/VehiclesPage'
import { DriversPage } from '@/features/drivers/DriversPage'
import { PartiesPage } from '@/features/parties/PartiesPage'
import { ExpensesPage } from '@/features/accounts/expenses/ExpensesPage'
import { InvoicesPage } from '@/features/accounts/invoices/InvoicesPage'
import { LedgersPage } from '@/features/accounts/ledgers/LedgersPage'
import { DistributionPage } from '@/features/distribution/DistributionPage'
import { ReportsPage } from '@/features/accounts/reports/ReportsPage'
import { AssetsPage } from '@/features/assets/AssetsPage'
import { RequireRole } from './RequireRole'
import { SettingsPage } from '@/features/settings/SettingsPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="trips" element={<TripsPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="ledgers" element={<LedgersPage />} />
        <Route path="distribution" element={<DistributionPage />} />
        <Route
          path="reports"
          element={
            <RequireRole roles={['owner', 'ca']} label="Reports">
              <ReportsPage />
            </RequireRole>
          }
        />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="parties" element={<PartiesPage />} />
        <Route path="more" element={<MorePage />} />
        <Route
          path="settings"
          element={
            <RequireRole roles={['owner']} label="Settings">
              <SettingsPage />
            </RequireRole>
          }
        />
      </Route>

      {/* Unknown paths land on the dashboard rather than a dead end. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
