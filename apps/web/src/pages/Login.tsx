import { useNavigate } from 'react-router-dom';
import { useDemoLogin, useGithubStatus } from '../api/hooks.js';

export function LoginPage() {
  const navigate = useNavigate();
  const demoLogin = useDemoLogin();
  const status = useGithubStatus();

  const demoAvailable = status.data?.demoMode ?? false;
  const oauthAvailable = status.data?.oauthConfigured ?? false;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>
          Vibe<span style={{ color: 'var(--accent)' }}>Track</span>
        </h1>
        <p>
          Claude Code와 GitHub의 작업 흔적을 모아, 지금 무엇이 구현됐고 무엇이 검증되지 않았으며
          다음에 무엇을 해야 하는지 보여주는 프로젝트 기억 서비스.
        </p>
        {oauthAvailable && (
          <a
            className="btn primary"
            style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}
            href="/api/auth/github"
          >
            GitHub로 로그인
          </a>
        )}
        {demoAvailable && (
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={demoLogin.isPending}
            onClick={() =>
              demoLogin.mutate(undefined, {
                onSuccess: () => navigate('/', { replace: true }),
              })
            }
          >
            {demoLogin.isPending ? '준비 중…' : '데모로 시작하기'}
          </button>
        )}
        {!demoAvailable && !oauthAvailable && !status.isLoading && (
          <div className="alert error">
            로그인 방법이 설정되지 않았습니다. DEMO_MODE=true 또는 GitHub OAuth 자격증명을
            설정하세요.
          </div>
        )}
        {demoLogin.isError && <div className="alert error">{demoLogin.error.message}</div>}
      </div>
    </div>
  );
}
