import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import StartScreen from './screens/StartScreen';
import DashboardLayout from './layouts/DashboardLayout';
import ProtectedRoute from './components/ProtectedRoute';
import { auth, onAuthStateChanged, getUserStatus, logout } from './firebase';

import AgreementsScreen from './screens/AgreementsScreen';
import AccountsScreen from './screens/AccountsScreen';
import AccountDetailScreen from './screens/AccountDetailScreen';
import AgreementDetailScreen from './screens/AgreementDetailScreen';
import DashboardsScreen from './screens/DashboardsScreen';
import TemplateBuildScreen from './screens/TemplateBuildScreen';
import AskAIScreen from './screens/AskAIScreen';
import SettingsScreen from './screens/SettingsScreen';
import AdminScreen from './screens/AdminScreen';
import ApprovalScreen from './screens/ApprovalScreen';

function App() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [blockedMessage, setBlockedMessage] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const status = await getUserStatus(currentUser);

        if (!status.isActive) {
          await logout();
          setBlockedMessage('Your account has been deactivated. Please contact your administrator.');
          setUser(null);
          setIsAdmin(false);
          setCheckingAuth(false);
          return;
        }

        setIsAdmin(status.isAdmin);
        setUser(currentUser);
      } else {
        setUser(null);
        setIsAdmin(false);
      }
      setCheckingAuth(false);
    });

    return unsubscribe;
  }, []);

  if (checkingAuth) {
    return null;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            user ? <Navigate to="/dashboard/agreements" replace /> : <StartScreen blockedMessage={blockedMessage} />
          }
        />

        {/* Public — no login required. The approvalId in the URL is itself
            the access token (see firebase.js createApprovalRequest). */}
        <Route path="/approve/:approvalId" element={<ApprovalScreen />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute user={user}>
              <DashboardLayout user={user} isAdmin={isAdmin} />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="agreements" replace />} />
          <Route path="agreements" element={<AgreementsScreen />} />
          <Route path="agreements/:agreementId" element={<AgreementDetailScreen />} />
          <Route path="accounts" element={<AccountsScreen />} />
          <Route path="accounts/:accountId" element={<AccountDetailScreen />} />
          <Route path="dashboards" element={<DashboardsScreen />} />
          <Route path="templates" element={<TemplateBuildScreen />} />
          <Route path="ask-ai" element={<AskAIScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route
            path="admin"
            element={isAdmin ? <AdminScreen /> : <Navigate to="/dashboard/agreements" replace />}
          />
        </Route>

        <Route
          path="*"
          element={<Navigate to={user ? '/dashboard/agreements' : '/'} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;