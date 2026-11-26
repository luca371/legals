import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import StartScreen from './screens/StartScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import ReviewLinkScreen from './screens/ReviewLinkScreen';
import ApprovalLinkScreen from './screens/ApprovalLinkScreen';
import DashboardLayout from './layouts/DashboardLayout';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthContext, profileFlags } from './AuthContext';
import { ConfirmProvider } from './components/ConfirmProvider';
import { onAuthStateChange, getUserStatus, getMfaStep, getAiFeatures, logout } from './supabase';
import MfaScreen from './screens/MfaScreen';

import AgreementsScreen from './screens/AgreementsScreen';
import AccountsScreen from './screens/AccountsScreen';
import AccountDetailScreen from './screens/AccountDetailScreen';
import AgreementDetailScreen from './screens/AgreementDetailScreen';
import DashboardsScreen from './screens/DashboardsScreen';
import TemplateBuildScreen from './screens/TemplateBuildScreen';
import AskAIScreen from './screens/AskAIScreen';
import DraftStudioScreen from './screens/DraftStudioScreen';
import SettingsScreen from './screens/SettingsScreen';
import AdminScreen from './screens/AdminScreen';
import TasksScreen from './screens/TasksScreen';
import { featureOn } from './aiFeatures';

function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState('reader');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [blockedMessage, setBlockedMessage] = useState('');
  // 'ok' | 'verify' (enter code) | 'enroll' (admin must set up two-factor)
  const [mfaStep, setMfaStep] = useState('ok');
  // AI features switched off for the organization ({ key: false }).
  const [aiFeatures, setAiFeatures] = useState({});

  useEffect(() => {
    const unsubscribe = onAuthStateChange(async (currentUser) => {
      if (currentUser) {
        const status = await getUserStatus(currentUser);

        if (!status.isActive) {
          await logout();
          setBlockedMessage('Your account has been deactivated. Please contact your administrator.');
          setUser(null);
          setProfile('reader');
          setCheckingAuth(false);
          return;
        }

        setMfaStep(await getMfaStep(status.profile === 'admin'));
        try {
          setAiFeatures(await getAiFeatures());
        } catch (err) {
          console.error('Could not load AI feature settings:', err);
        }
        setProfile(status.profile);
        setUser(currentUser);
      } else {
        setUser(null);
        setProfile('reader');
        setMfaStep('ok');
      }
      setCheckingAuth(false);
    });

    return unsubscribe;
  }, []);

  if (checkingAuth) {
    return null;
  }

  const auth = { ...profileFlags(profile), aiFeatures, setAiFeatures };
  const { isAdmin, canWrite } = auth;

  const handleMfaDone = async () => {
    setMfaStep(await getMfaStep(isAdmin));
  };

  return (
    <AuthContext.Provider value={auth}>
    <ConfirmProvider>
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            user ? <Navigate to="/dashboard/agreements" replace /> : <StartScreen blockedMessage={blockedMessage} />
          }
        />

        <Route path="/reset-password" element={<ResetPasswordScreen />} />
        <Route path="/review/:reviewId" element={<ReviewLinkScreen />} />
        <Route path="/approve/:approvalId" element={<ApprovalLinkScreen />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute user={user}>
              {mfaStep === 'ok' ? (
                <DashboardLayout user={user} isAdmin={isAdmin} />
              ) : (
                <MfaScreen mode={mfaStep} onDone={handleMfaDone} />
              )}
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="agreements" replace />} />
          <Route path="agreements" element={<AgreementsScreen />} />
          <Route path="agreements/:agreementId" element={<AgreementDetailScreen />} />
          <Route path="accounts" element={<AccountsScreen />} />
          <Route path="accounts/:accountId" element={<AccountDetailScreen />} />
          <Route path="dashboards" element={<DashboardsScreen />} />
          <Route path="templates" element={canWrite ? <TemplateBuildScreen /> : <Navigate to="/dashboard/agreements" replace />} />
          <Route path="tasks" element={<TasksScreen />} />
          <Route path="draft" element={canWrite && featureOn(aiFeatures, 'drafting') ? <DraftStudioScreen /> : <Navigate to="/dashboard/agreements" replace />} />
          <Route path="ask-ai" element={featureOn(aiFeatures, 'ask_ai') ? <AskAIScreen /> : <Navigate to="/dashboard/agreements" replace />} />
          <Route path="settings" element={canWrite ? <SettingsScreen /> : <Navigate to="/dashboard/agreements" replace />} />
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
    </ConfirmProvider>
    </AuthContext.Provider>
  );
}

export default App;