import { useState } from 'react';
import type { ProjectDto } from '@vibetrack/shared';
import {
  useClaudeSetup,
  useCreateToken,
  useGithubStatus,
  useMcpTokens,
  useRevokeToken,
  useSimulateGithub,
} from '../api/hooks.js';

function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <h3 style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 6px' }}>{label}</h3>}
      <div className="copy-row">
        <pre className="code-block">{text}</pre>
        <button
          className="btn small"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? '복사됨!' : '복사'}
        </button>
      </div>
    </div>
  );
}

export function SettingsPage({ project }: { project: ProjectDto }) {
  const setup = useClaudeSetup(project.id);
  const tokens = useMcpTokens(project.id);
  const createToken = useCreateToken(project.id);
  const revokeToken = useRevokeToken(project.id);
  const githubStatus = useGithubStatus();
  const simulate = useSimulateGithub(project.id);
  const [newToken, setNewToken] = useState<string | null>(null);

  const setupData = setup.data?.setup;
  const isDemo = githubStatus.data?.demoMode ?? false;

  return (
    <>
      <h1 className="page-title">연결 및 설정</h1>
      <p className="page-desc">GitHub 저장소, Claude Code MCP 연결, 토큰을 관리합니다.</p>

      <div className="card">
        <h2>연결된 GitHub 저장소</h2>
        {project.repository ? (
          <div className="list-item">
            <div>
              <div className="title">{project.repository.fullName}</div>
              <div className="meta">기본 브랜치: {project.repository.defaultBranch}</div>
            </div>
            <span className="badge implemented">연결됨</span>
          </div>
        ) : (
          <div className="empty">연결된 저장소가 없습니다. 온보딩에서 저장소를 연결하세요.</div>
        )}
        <div className="chip-list" style={{ marginTop: 10 }}>
          <span className="chip">
            GitHub App: {githubStatus.data?.appConfigured ? '설정됨' : '미설정 (DEMO)'}
          </span>
          <span className="chip">
            Webhook: {githubStatus.data?.webhookConfigured ? '설정됨' : '미설정'}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>Claude Code MCP 연결</h2>
        {setupData && (
          <>
            <div className="chip-list" style={{ marginBottom: 12 }}>
              <span className="chip">endpoint: {setupData.mcpUrl}</span>
              <span className="chip">projectId: {setupData.projectId}</span>
              <span className={`badge ${setupData.lastMcpActivityAt ? 'implemented' : 'planned'}`}>
                {setupData.lastMcpActivityAt
                  ? `마지막 연결: ${new Date(setupData.lastMcpActivityAt).toLocaleString('ko-KR')}`
                  : '아직 연결 기록 없음'}
              </span>
            </div>
            <CopyBlock label="1) Claude Code에 MCP 추가" text={setupData.addCommandExample} />
            <CopyBlock label="2) 또는 .mcp.json에 추가" text={setupData.mcpJsonExample} />
            <CopyBlock label="3) CLAUDE.md에 추가할 작업 규칙" text={setupData.claudeMdExample} />
            <CopyBlock label="4) 초기 기능 지도 생성 프롬프트 (한 번 실행)" text={setupData.bootstrapPrompt} />
          </>
        )}
      </div>

      <div className="card">
        <h2>MCP 연결 토큰</h2>
        {newToken && (
          <div className="alert success">
            새 토큰이 발급되었습니다. 지금만 표시됩니다:
            <pre className="code-block" style={{ marginTop: 8 }}>{newToken}</pre>
          </div>
        )}
        {(tokens.data?.tokens ?? []).map((token) => (
          <div className="list-item" key={token.id}>
            <div>
              <div className="title">
                {token.name} <code>({token.tokenPrefix}…)</code>
              </div>
              <div className="meta">
                발급 {new Date(token.createdAt).toLocaleDateString('ko-KR')}
                {token.lastUsedAt && ` · 마지막 사용 ${new Date(token.lastUsedAt).toLocaleString('ko-KR')}`}
              </div>
            </div>
            {token.revokedAt ? (
              <span className="badge retired">폐기됨</span>
            ) : (
              <button
                className="btn danger small"
                onClick={() => revokeToken.mutate(token.id)}
                disabled={revokeToken.isPending}
              >
                폐기
              </button>
            )}
          </div>
        ))}
        <button
          className="btn primary"
          style={{ marginTop: 12 }}
          disabled={createToken.isPending}
          onClick={() =>
            createToken.mutate(
              { name: `token-${new Date().toISOString().slice(0, 10)}` },
              { onSuccess: (data) => setNewToken(data.token.plaintext ?? null) },
            )
          }
        >
          새 토큰 발급
        </button>
      </div>

      {isDemo && (
        <div className="card">
          <h2>데모: GitHub 이벤트 시뮬레이션</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
            실제 webhook 파이프라인(저장 → Job → 처리)을 그대로 통과하는 합성 이벤트를 보냅니다.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small" disabled={simulate.isPending} onClick={() => simulate.mutate('push_tracked')}>
              push (추적되는 파일)
            </button>
            <button className="btn small" disabled={simulate.isPending} onClick={() => simulate.mutate('push_untracked')}>
              push (추적 안 된 파일)
            </button>
            <button className="btn small" disabled={simulate.isPending} onClick={() => simulate.mutate('check_success')}>
              CI 성공
            </button>
            <button className="btn small" disabled={simulate.isPending} onClick={() => simulate.mutate('check_failure')}>
              CI 실패
            </button>
            <button className="btn small" disabled={simulate.isPending} onClick={() => simulate.mutate('pr_opened')}>
              PR 열림
            </button>
          </div>
          {simulate.isSuccess && <div className="alert success" style={{ marginTop: 10 }}>이벤트가 처리되었습니다. 대시보드/Inbox를 확인하세요.</div>}
        </div>
      )}

      <div className="card">
        <h2>위험 구역</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          프로젝트 삭제는 API <code>DELETE /api/projects/:id</code>로 제공됩니다. 삭제하면 기능
          트리·작업 기록·증거가 모두 제거됩니다 (감사 로그는 유지).
        </p>
      </div>
    </>
  );
}
