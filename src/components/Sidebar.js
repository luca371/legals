import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const NAV_ITEMS = [
  { path: '/dashboard/agreements', label: 'Agreements', icon: IconAgreements },
  { path: '/dashboard/accounts', label: 'Accounts', icon: IconAccounts },
  { path: '/dashboard/dashboards', label: 'Dashboards', icon: IconDashboards },
  { path: '/dashboard/templates', label: 'Template build', icon: IconTemplates },
  { path: '/dashboard/ask-ai', label: 'Ask AI', icon: IconAskAI },
  { path: '/dashboard/settings', label: 'Settings', icon: IconSettings },
];

const ADMIN_ITEM = { path: '/dashboard/admin', label: 'Admin', icon: IconAdmin };

function Sidebar({ collapsed, onToggle, isAdmin }) {
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar__brand">
        <div className="sidebar__brand-info">
          <img src="/images/logo.png" alt="Legal Space" className="sidebar__logo" />
          <span className="sidebar__brand-name">Legal Space</span>
        </div>

        <button
          type="button"
          className="sidebar__toggle"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <IconWaffleToggle />
        </button>
      </div>

      <nav className="sidebar__nav">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            title={label}
            className={({ isActive }) =>
              `sidebar__item ${isActive ? 'sidebar__item--active' : ''}`
            }
          >
            <Icon className="sidebar__icon" />
            <span className="sidebar__label">{label}</span>
          </NavLink>
        ))}
      </nav>

      {isAdmin && (
        <>
          <div className="sidebar__divider" />

          <nav className="sidebar__nav sidebar__nav--admin">
            <NavLink
              to={ADMIN_ITEM.path}
              title={ADMIN_ITEM.label}
              className={({ isActive }) =>
                `sidebar__item sidebar__item--admin ${isActive ? 'sidebar__item--active' : ''}`
              }
            >
              <ADMIN_ITEM.icon className="sidebar__icon" />
              <span className="sidebar__label">{ADMIN_ITEM.label}</span>
            </NavLink>
          </nav>
        </>
      )}
    </aside>
  );
}

function IconWaffleToggle({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Inline icon set (no external deps) ---------- */

function IconAgreements({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M15 3v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12h6M9 15.5h6M9 8.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconAccounts({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 20c0-3.6 3.13-6 7-6s7 2.4 7 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconDashboards({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="11" width="7" height="9.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconTemplates({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9h17" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 9v11" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconAskAI({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3l1.8 4.6L18.4 9.4 13.8 11.2 12 16l-1.8-4.8L5.6 9.4l4.6-1.8L12 3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M18.5 15.5l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9.9-2.2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function IconSettings({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M19.4 13.5a7.4 7.4 0 0 0 0-3l1.9-1.4-2-3.4-2.2.7a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.2-.7-2 3.4 1.9 1.4a7.4 7.4 0 0 0 0 3L2.7 14.9l2 3.4 2.2-.7c.76.66 1.64 1.17 2.6 1.5l.5 2.4h4l.5-2.4a7.6 7.6 0 0 0 2.6-1.5l2.2.7 2-3.4-1.9-1.4z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconAdmin({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3l7 3v5.5c0 4.6-3 7.6-7 9.5-4-1.9-7-4.9-7-9.5V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 12.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default Sidebar;