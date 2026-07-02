import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { logout } from '../firebase';
import './DashboardLayout.css';

const SECTION_LABELS = {
  agreements: 'Agreements',
  accounts: 'Accounts',
  dashboards: 'Dashboards',
  templates: 'Template build',
  'ask-ai': 'Ask AI',
  settings: 'Settings',
  admin: 'Admin',
};

function DashboardLayout({ user, isAdmin }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const currentKey = location.pathname.split('/dashboard/')[1] || 'agreements';
  const sectionTitle = SECTION_LABELS[currentKey] || 'Dashboard';

  const handleLogout = async () => {
    try {
      await logout();
      // onAuthStateChanged in App.js picks this up and redirects to /
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const displayName = user?.displayName || user?.email || 'User';

  return (
    <div className="dashboard">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
        isAdmin={isAdmin}
      />

      <div className="dashboard__main">
        <header className="dashboard__topbar">
          <h1 className="dashboard__section-title">{sectionTitle}</h1>

          <div className="dashboard__user">
            <span className="dashboard__user-name">{displayName}</span>
            <button className="dashboard__logout" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </header>

        <main className="dashboard__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default DashboardLayout;