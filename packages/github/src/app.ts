import { App } from 'octokit';

export interface GithubAppConfig {
  appId?: string;
  privateKey?: string;
  webhookSecret?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface GithubRepoSummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
}

/**
 * GitHub App adapter.
 * 자격증명이 없으면 isConfigured()가 false를 반환하고 앱은 DEMO_MODE로 계속 동작한다.
 * Octokit App 인스턴스는 실제로 필요할 때만 lazy 생성한다.
 */
export class GithubAppAdapter {
  private readonly config: GithubAppConfig;
  private app: App | null = null;

  constructor(config: GithubAppConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.appId && this.config.privateKey);
  }

  hasOAuth(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  webhookSecret(): string | undefined {
    return this.config.webhookSecret;
  }

  private getApp(): App {
    if (!this.isConfigured()) {
      throw new Error('GitHub App이 설정되지 않았습니다. GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY를 확인하세요.');
    }
    if (!this.app) {
      // 환경변수에 \n 으로 이스케이프된 PEM을 지원한다.
      const privateKey = (this.config.privateKey ?? '').replace(/\\n/g, '\n');
      this.app = new App({
        appId: this.config.appId ?? '',
        privateKey,
        ...(this.hasOAuth()
          ? {
              oauth: {
                clientId: this.config.clientId ?? '',
                clientSecret: this.config.clientSecret ?? '',
              },
            }
          : {}),
      });
    }
    return this.app;
  }

  /** 설치(installation)가 접근할 수 있는 저장소 목록 */
  async listInstallationRepos(installationId: number): Promise<GithubRepoSummary[]> {
    const octokit = await this.getApp().getInstallationOctokit(installationId);
    const repos = await octokit.paginate('GET /installation/repositories', { per_page: 100 });
    return repos.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      owner: repo.owner.login,
      name: repo.name,
      defaultBranch: repo.default_branch,
      private: repo.private,
    }));
  }

  /** OAuth code를 사용자 access token으로 교환 (GitHub 로그인) */
  async exchangeOAuthCode(code: string): Promise<{ token: string }> {
    if (!this.hasOAuth()) {
      throw new Error('GitHub OAuth가 설정되지 않았습니다.');
    }
    const app = this.getApp();
    const { authentication } = await app.oauth.createToken({ code });
    return { token: authentication.token };
  }
}
