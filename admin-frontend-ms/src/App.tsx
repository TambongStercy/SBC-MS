import { Route, Routes, useLocation } from "react-router-dom";
import OverViewPage from "./pages/overViewPage";
import Deconnexion from "./pages/Deconnexion";
import Users from "./pages/Users";
import Sidebar from "./components/Sidebar";
import UsersPage from "./pages/usersPage";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import ProductsManagementPage from "./pages/ProductsManagementPage";
import TombolaManagementPage from "./pages/TombolaManagementPage";
import TombolaDrawPage from './pages/TombolaDrawPage';
import TransactionManagementPage from './pages/TransactionManagementPage';
import AccountTransactionsManagementPage from './pages/AccountTransactionsManagementPage';
import SettingsManagementPage from './pages/SettingsManagementPage';
import NotificationsPage from './pages/NotificationsPage';
import Partners from './pages/Partners';
import FixFeexpayPaymentsPage from './pages/FixFeexpayPaymentsPage';
import StorageMonitoringPage from './pages/StorageMonitoringPage';
import { Toaster } from 'react-hot-toast';

function App() {
  const location = useLocation();
  const isLoginRoute = location.pathname === "/login";

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      <Toaster
        position="top-left"
        toastOptions={{
          style: {
            background: '#333',
            color: '#fff',
          },
          error: {
            duration: 5000,
          },
        }}
      />

      {/* Background Gradient and Blur */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 opacity-80" />
        <div className="absolute inset-0 backdrop-blur-sm" />
      </div>

      {/* Sidebar - Ensure it's above background */}
      {!isLoginRoute && <div className="relative z-10"><Sidebar /></div>}

      {/* Main Content - Ensure it's above background */}
      <main className="relative z-10 flex-grow overflow-auto">
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<OverViewPage />} />
            <Route path="/dashboard" element={<OverViewPage />} />
            <Route path="/users" element={<Users />} />
            <Route path="/partners" element={<Partners />} />
            <Route path="/products" element={<ProductsManagementPage />} />
            <Route path="/transactions" element={<TransactionManagementPage />} />
            <Route path="/account-transactions" element={<AccountTransactionsManagementPage />} />
            <Route path="/settings" element={<SettingsManagementPage />} />
            <Route path="/storage" element={<StorageMonitoringPage />} />
            <Route path="/tombola" element={<TombolaManagementPage />} />
            <Route path="/tombola/draw/:monthId" element={<TombolaDrawPage />} />
            <Route path="/logout" element={<Deconnexion />} />
            <Route path="/userpage/:userId" element={<UsersPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/fix-feexpay-payments" element={<FixFeexpayPaymentsPage />} />
          </Route>

          <Route path="*" element={<Login />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
