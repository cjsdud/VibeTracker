import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { ProjectDto, UserDto } from '@vibetrack/shared';
import { useInbox, useLogout } from '../api/hooks.js';

const tabs = [
  { to: '/', label: '대시보드', icon: '📌' },
  { to: '/features', label: '기능 지도', icon: '🗺️' },
  { to: '/inbox', label: 'Inbox', icon: '📥' },
  { to: '/activity', label: '활동 기록', icon: '🕘' },
  { to: '/settings', label: '연결/설정', icon: '⚙️' },
];

export function Layout({
  project,
  projects,
  onSelectProject,
  user,
}: {
  project: ProjectDto;
  projects: ProjectDto[];
  onSelectProject: (id: string) => void;
  user: UserDto;
}) {
  const navigate = useNavigate();
  const inbox = useInbox(project.id);
  const logout = useLogout();
  const openCount = inbox.data?.items.length ?? 0;

  const projectSelector = (
    <select
      value={project.id}
      onChange={(e) => {
        if (e.target.value === '__new') {
          navigate('/projects/new');
          return;
        }
        onSelectProject(e.target.value);
        navigate('/');
      }}
      style={{
        width: '100%',
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        fontWeight: 700,
        marginBottom: 8,
        background: 'var(--surface)',
        color: 'var(--text)',
      }}
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option value="__new">＋ 새 프로젝트 만들기</option>
    </select>
  );

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
        {projectSelector}
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
