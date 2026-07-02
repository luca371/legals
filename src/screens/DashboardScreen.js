import './DashboardScreen.css';
import { logout } from '../firebase';

function DashboardScreen({ user }) {
  const handleLogout = async () => {
    try {
      await logout();
      // onAuthStateChanged in App.js picks this up and switches back to StartScreen
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const displayName = user?.displayName || user?.email || 'User';

  return (
    <div className="dashboard">
      <header className="dashboard__topbar">
        <div className="dashboard__brand">
          <img src="/images/logo.png" alt="Legal Space" className="dashboard__logo" />
          <span className="dashboard__brand-name">Legal Space</span>
        </div>

        <div className="dashboard__user">
          <span className="dashboard__user-name">{displayName}</span>
          <button className="dashboard__logout" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="dashboard__content">
        {/* TODO: conținutul real al dashboard-ului - detalii ulterioare */}
        <p className="dashboard__placeholder">Dashboard content goes here</p>
      </main>
    </div>
  );
}

export default DashboardScreen;