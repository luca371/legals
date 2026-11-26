import { NavLink } from 'react-router-dom';
import AskELabel from './AskELabel';
import { useAuth } from '../AuthContext';
import { featureOn } from '../aiFeatures';
import './Sidebar.css';

const NAV_ITEMS = [
  { path: '/dashboard/agreements', label: 'Agreements', icon: IconAgreements },
  { path: '/dashboard/accounts', label: 'Accounts', icon: IconAccounts },
  { path: '/dashboard/dashboards', label: 'Dashboards', icon: IconDashboards },
  { path: '/dashboard/tasks', label: 'Tasks', icon: IconTasks },
  { path: '/dashboard/templates', label: 'Template build', icon: IconTemplates, writerOnly: true },
  { path: '/dashboard/draft', label: 'Draft with AI', icon: IconDraft, writerOnly: true, feature: 'drafting' },
  { path: '/dashboard/ask-ai', label: 'Ask E', labelNode: <AskELabel />, icon: IconAskAI, feature: 'ask_ai' },
  { path: '/dashboard/settings', label: 'Settings', icon: IconSettings, writerOnly: true },
];

const ADMIN_ITEM = { path: '/dashboard/admin', label: 'Admin', icon: IconAdmin };

function Sidebar({ collapsed, onToggle, isAdmin }) {
  const { canWrite, aiFeatures } = useAuth();
  const navItems = NAV_ITEMS.filter(
    (item) => (!item.writerOnly || canWrite) && (!item.feature || featureOn(aiFeatures, item.feature))
  );

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar__brand">
        <div className="sidebar__brand-info">
          <span className="sidebar__brand-name">EsoVia</span>
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
        {navItems.map(({ path, label, labelNode, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            data-tour={`nav-${path.split('/').pop()}`}
            title={label}
            className={({ isActive }) =>
              `sidebar__item ${isActive ? 'sidebar__item--active' : ''}`
            }
          >
            <Icon className="sidebar__icon" />
            <span className="sidebar__label">{labelNode || label}</span>
          </NavLink>
        ))}
      </nav>

      {isAdmin && (
        <>
          <div className="sidebar__divider" />

          <nav className="sidebar__nav sidebar__nav--admin">
            <NavLink
              to={ADMIN_ITEM.path}
              data-tour="nav-admin"
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

function IconTasks({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="3.5" width="16" height="17" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 9l1.6 1.6L12.5 7.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 15.5l1.6 1.6 2.9-2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 9.5H17M14.5 16H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

function IconDraft({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 3.5h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13.5 3.5v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 13.5l3-3 2 2-3 3-2.5.5.5-2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
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
  // Gear with 8 evenly spaced teeth, generated from its geometry so every tooth is identical.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10.15 5.04 L10.38 2.54 L13.62 2.54 L13.85 5.04 A7.20 7.20 0 0 1 15.61 5.77 L17.54 4.16 L19.84 6.46 L18.23 8.39 A7.20 7.20 0 0 1 18.96 10.15 L21.46 10.38 L21.46 13.62 L18.96 13.85 A7.20 7.20 0 0 1 18.23 15.61 L19.84 17.54 L17.54 19.84 L15.61 18.23 A7.20 7.20 0 0 1 13.85 18.96 L13.62 21.46 L10.38 21.46 L10.15 18.96 A7.20 7.20 0 0 1 8.39 18.23 L6.46 19.84 L4.16 17.54 L5.77 15.61 A7.20 7.20 0 0 1 5.04 13.85 L2.54 13.62 L2.54 10.38 L5.04 10.15 A7.20 7.20 0 0 1 5.77 8.39 L4.16 6.46 L6.46 4.16 L8.39 5.77 A7.20 7.20 0 0 1 10.15 5.04 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.9" stroke="currentColor" strokeWidth="1.6" />
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