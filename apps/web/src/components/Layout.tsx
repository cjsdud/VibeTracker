import { NavLink, Outlet } from 'react-router-dom';
import type { ProjectDto, UserDto } from '@vibetrack/shared';
import { useInbox, useLogout } from '../api/hooks.js';

const tabs = [
  { to: '/', label: '대시보드', icon: '📌' },
  { to: '/features', label: '기능 지도', icon: '🗺️' },
  { to: '/inbox', label: 'Inbox', icon: '📥' },
  { to: '/activity', label: '활동 기록', icon: '🕘' },
  { to: '/settings', label: '연결/설정', icon: '⚙️' },
];

export function Layout({ project, user }: { project: ProjectDto; user: UserDto }) {
  const inbox = useInbox(project.id);
  const logout = useLogout();
  const openCount = inbox.data?.items.length ?? 0;

  const navItems = tabs.map((tab) => (
    <NavLink
      key={tab.to}
      to={tab.to}
      end={tab.to === '/'}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
    >
      <span>{tab.label}</span>
      {tab.to === '/inbox' && openCount > 0 && <span className="nav-badge">{openCount}</span>}
    </NavLink>
  ));

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Vibe<span>Track</span>
        </div>
        <div className="nav-item" style={{ fontWeight: 700, color: 'var(--text)' }}>
          {project.name}
        </div>
        <nav>{navItems}</nav>
        <div className="spacer" />
        <div className="user-row">
          <span>{user.name}</span>
          <button className="btn small" onClick={() => logout.mutate()}>
            로그아웃
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <nav className="mobile-tabs">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.to === '/inbox' && openCount > 0 && <span className="nav-badge">{openCount}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
