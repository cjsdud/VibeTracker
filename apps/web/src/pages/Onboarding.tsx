import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { ProjectDto } from '@vibetrack/shared';
import {
  useClaudeSetup,
  useConnectRepo,
  useCreateProject,
  useCreateToken,
  useFeatureTree,
  useGithubRepos,
  useMcpTokens,
} from '../api/hooks.js';

/**
 * 온보딩: 한 화면에 한 행동만.
 * 1) 프로젝트 만들기 → 2) 저장소 연결 → 3) Claude Code 연결(토큰) →
 * 4) bootstrap 프롬프트 실행 → 5) 기능 지도 검토/승인 (기능 지도 화면으로 이동)
 */
export function OnboardingPage({ project }: { project: ProjectDto | null }) {
  const navigate = useNavigate();
  const createProject = useCreateProject();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');

  const repos = useGithubRepos(!!project && !project.repository);
  const connectRepo = useConnectRepo(project?.id ?? '');
  const [selectedRepo, setSelectedRepo] = useState('');

  const tokens = useMcpTokens(project?.id ?? null);
  const createToken = useCreateToken(project?.id ?? '');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [repoSkipped, setRepoSkipped] = useState(false);
  const setup = useClaudeSetup(project?.id ?? null);
  const tree = useFeatureTree(project?.id ?? null);

  const hasRepo = !!project?.repository;
  const hasToken = (tokens.data?.tokens ?? []).some((t) => !t.revokedAt);
  const featureCount = tree.data?.tree.length ?? 0;
  const hasFeatures = featureCount > 0;

  // 저장소는 나중에 연결해도 핵심 루프(Claude Code 기록)는 동작한다
  if (project && hasToken && hasFeatures) {
    return <Navigate to="/features" replace />;
  }

  const step = !project ? 1 : !hasRepo && !repoSkipped ? 2 : !hasToken ? 3 : !hasFeatures ? 4 : 5;

  const steps = [
    '프로젝트 만들기',
    'GitHub 저장소 연결',
    'Claude Code 연결',
    '초기 기능 지도 생성',
    '기능 지도 검토·승인',
  ];

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <h1>시작하기</h1>
        <ol className="step-list">
          {steps.map((label, i) => (
            <li key={label} className={i + 1 < step ? 'done' : i + 1 === step ? 'current' : ''}>
              <span className="step-dot">{i + 1 < step ? '✓' : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <>
            <p>추적할 프로젝트를 만드세요.</p>
            <div className="field">
              <label>프로젝트 이름</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 리뷰 인사이트"
              />
            </div>
            <div className="field">
              <label>목표 (선택)</label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                placeholder="이 프로젝트가 사용자에게 주는 가치 한두 문장"
              />
            </div>
            <button
              className="btn primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={!name.trim() || createProject.isPending}
              onClick={() =>
                createProject.mutate({ name: name.trim(), goal: goal.trim() || undefined })
              }
            >
              프로젝트 만들기
            </button>
            {createProject.isError && (
              <div className="alert error" style={{ marginTop: 10 }}>
                {createProject.error.message}
              </div>
            )}
          </>
        )}

        {step === 2 && project && (
          <>
            <p>추적할 GitHub 저장소를 연결하세요.</p>
            {repos.isError && <div className="alert error">{repos.error.message}</div>}
            <div className="field">
              <label>저장소</label>
              <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)}>
                <option value="">선택…</option>
                {(repos.data?.repos ?? []).map((repo) => (
                  <option key={repo.fullName} value={repo.fullName}>
                    {repo.fullName} ({repo.defaultBranch})
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={!selectedRepo || connectRepo.isPending}
              onClick={() => {
                const repo = repos.data?.repos.find((r) => r.fullName === selectedRepo);
                if (!repo) return;
                connectRepo.mutate({
                  owner: repo.owner,
                  name: repo.name,
                  defaultBranch: repo.defaultBranch,
                  installationId: repo.installationId,
                });
              }}
            >
              저장소 연결
            </button>
            {connectRepo.isError && (
              <div className="alert error" style={{ marginTop: 10 }}>
                {connectRepo.error.message}
              </div>
            )}
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
              onClick={() => setRepoSkipped(true)}
            >
              나중에 연결하기 (건너뛰기)
            </button>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
              GitHub App이 아직 설정되지 않았다면 건너뛰세요. Claude Code 작업 기록은 저장소 연결
              없이도 동작하며, 커밋/CI 검증만 나중에 활성화됩니다.
            </p>
          </>
        )}

        {step === 3 && project && (
          <>
            <p>Claude Code가 이 프로젝트에 기록을 남길 수 있도록 연결 토큰을 발급하세요.</p>
            <button
              className="btn primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={createToken.isPending}
              onClick={() =>
                createToken.mutate(
                  { name: 'default' },
                  { onSuccess: (d) => setPlaintext(d.token.plaintext ?? null) },
                )
              }
            >
              연결 토큰 발급
            </button>
          </>
        )}

        {step === 4 && project && (
          <>
            {plaintext && (
              <div className="alert success">
                토큰 (지금만 표시됩니다):
                <pre className="code-block" style={{ marginTop: 6 }}>
                  {plaintext}
                </pre>
              </div>
            )}
            <p>
              Claude Code에 MCP를 등록하고, 아래 프롬프트를 한 번 실행하세요. Claude Code가 저장소를
              분석해 기능 지도 초안을 등록하면 이 화면이 자동으로 넘어갑니다.
            </p>
            {setup.data && (
              <>
                <pre className="code-block">{setup.data.setup.addCommandExample}</pre>
                <pre className="code-block" style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {setup.data.setup.bootstrapPrompt}
                </pre>
              </>
            )}
            <div className="alert info">기능 지도 초안을 기다리는 중… (자동 새로고침)</div>
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => navigate('/settings')}
            >
              연결 안내 전체 보기 (설정)
            </button>
          </>
        )}
      </div>
    </div>
  );
}
