import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useMe, useProjects } from './api/hooks.js';
import { Layout } from './components/Layout.js';
import { LoginPage } from './pages/Login.js';
import { OnboardingPage } from './pages/Onboarding.js';
import { NewProjectPage } from './pages/NewProject.js';
import { DashboardPage } from './pages/Dashboard.js';
import { FeatureMapPage } from './pages/FeatureMap.js';
import { InboxPage } from './pages/Inbox.js';
import { ActivityPage } from './pages/Activity.js';
import { SettingsPage } from './pages/Settings.js';

const PROJECT_STORAGE_KEY = 'vt_selected_project';

export function App() {
  const me = useMe();
  const projects = useProjects(!!me.data?.user);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    localStorage.getItem(PROJECT_STORAGE_KEY),
  );

  const selectProject = (id: string) => {
    localStorage.setItem(PROJECT_STORAGE_KEY, id);
    setSelectedId(id);
  };

  if (me.isLoading) {
    return <div className="auth-page">불러오는 중…</div>;
  }
  if (!me.data?.user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (projects.isLoading) {
    return <div className="auth-page">프로젝트 불러오는 중…</div>;
  }

  const projectList = projects.data?.projects ?? [];
  const project = projectList.find((p) => p.id === selectedId) ?? projectList[0] ?? null;

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/onboarding" element={<OnboardingPage project={project} />} />
      <Route path="/projects/new" element={<NewProjectPage onCreated={selectProject} />} />
      {project === null ? (
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      ) : (
        <Route
          element={
            <Layout
              project={project}
              projects={projectList}
              onSelectProject={selectProject}
              user={me.data.user}
            />
          }
        >
          <Route path="/" element={<DashboardPage project={project} />} />
          <Route path="/features" element={<FeatureMapPage project={project} />} />
          <Route path="/features/:featureId" element={<FeatureMapPage project={project} />} />
          <Route path="/inbox" element={<InboxPage project={project} />} />
          <Route path="/activity" element={<ActivityPage project={project} />} />
          <Route path="/settings" element={<SettingsPage project={project} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}
