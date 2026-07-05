import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityItemDto,
  ChangeProposalDto,
  ClaudeSetupDto,
  DashboardCounts,
  FeatureDetailDto,
  FeatureNodeDto,
  GithubEventDto,
  InboxItemDto,
  McpTokenDto,
  NextTaskDto,
  ProjectDto,
  UserDto,
  VerificationRunDto,
  WorkUpdateDto,
} from '@vibetrack/shared';
import { api } from './client.js';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: UserDto | null }>('/api/auth/me'),
    staleTime: 60_000,
  });
}

export function useProjects(enabled = true) {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: ProjectDto[] }>('/api/projects'),
    enabled,
  });
}

export function useDashboard(projectId: string | null) {
  return useQuery({
    queryKey: ['dashboard', projectId],
    queryFn: () =>
      api<{ counts: DashboardCounts; nextTask: NextTaskDto; recentWork: WorkUpdateDto[] }>(
        `/api/projects/${projectId}/dashboard`,
      ),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
}

export function useFeatureTree(projectId: string | null) {
  return useQuery({
    queryKey: ['features', projectId],
    queryFn: () => api<{ tree: FeatureNodeDto[] }>(`/api/projects/${projectId}/features`),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
}

export function useFeatureDetail(projectId: string | null, featureId: string | null) {
  return useQuery({
    queryKey: ['feature', projectId, featureId],
    queryFn: () =>
      api<{ feature: FeatureDetailDto }>(`/api/projects/${projectId}/features/${featureId}`),
    enabled: !!projectId && !!featureId,
  });
}

export function useInbox(projectId: string | null, status: 'OPEN' | 'ALL' = 'OPEN') {
  return useQuery({
    queryKey: ['inbox', projectId, status],
    queryFn: () =>
      api<{ items: InboxItemDto[] }>(`/api/projects/${projectId}/inbox?status=${status}`),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
}

export function useActivity(projectId: string | null) {
  return useQuery({
    queryKey: ['activity', projectId],
    queryFn: () => api<{ items: ActivityItemDto[] }>(`/api/projects/${projectId}/activity`),
    enabled: !!projectId,
    refetchInterval: 20_000,
  });
}

export function useProposals(projectId: string | null) {
  return useQuery({
    queryKey: ['proposals', projectId],
    queryFn: () => api<{ proposals: ChangeProposalDto[] }>(`/api/projects/${projectId}/proposals`),
    enabled: !!projectId,
  });
}

export function useMcpTokens(projectId: string | null) {
  return useQuery({
    queryKey: ['mcp-tokens', projectId],
    queryFn: () => api<{ tokens: McpTokenDto[] }>(`/api/projects/${projectId}/mcp-tokens`),
    enabled: !!projectId,
  });
}

export function useClaudeSetup(projectId: string | null) {
  return useQuery({
    queryKey: ['claude-setup', projectId],
    queryFn: () => api<{ setup: ClaudeSetupDto }>(`/api/projects/${projectId}/claude-setup`),
    enabled: !!projectId,
  });
}

export function useGithubStatus() {
  return useQuery({
    queryKey: ['github-status'],
    queryFn: () =>
      api<{
        appConfigured: boolean;
        oauthConfigured: boolean;
        webhookConfigured: boolean;
        demoMode: boolean;
      }>('/api/github/status'),
  });
}

export function useGithubRepos(enabled: boolean) {
  return useQuery({
    queryKey: ['github-repos'],
    queryFn: () =>
      api<{
        repos: { installationId: string | null; fullName: string; owner: string; name: string; defaultBranch: string }[];
        demo: boolean;
      }>('/api/github/repos'),
    enabled,
  });
}

export function useVerificationRuns(projectId: string | null) {
  return useQuery({
    queryKey: ['verification-runs', projectId],
    queryFn: () =>
      api<{ runs: VerificationRunDto[] }>(`/api/projects/${projectId}/verification-runs`),
    enabled: !!projectId,
  });
}

export function useGithubEvents(projectId: string | null) {
  return useQuery({
    queryKey: ['github-events', projectId],
    queryFn: () => api<{ events: GithubEventDto[] }>(`/api/projects/${projectId}/github-events`),
    enabled: !!projectId,
  });
}

/** 프로젝트 데이터 전반을 무효화 (승인/거절 등 상태 변화 후) */
export function useInvalidateProject() {
  const queryClient = useQueryClient();
  return (projectId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['dashboard', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['features', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['inbox', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['activity', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['proposals', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['feature', projectId] });
  };
}

export function useDemoLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ user: UserDto }>('/api/auth/demo-login', { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries(),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login';
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; goal?: string }) =>
      api<{ project: ProjectDto }>('/api/projects', { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useApproveFeatureMap(projectId: string) {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: () =>
      api<{ version: number }>(`/api/projects/${projectId}/feature-map/approve`, {
        method: 'POST',
      }),
    onSuccess: () => invalidate(projectId),
  });
}

export function useProposalAction(projectId: string) {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (params: { proposalId: string; action: 'approve' | 'reject'; note?: string }) =>
      api(`/api/projects/${projectId}/proposals/${params.proposalId}/${params.action}`, {
        method: 'POST',
        body: params.action === 'reject' ? { note: params.note } : {},
      }),
    onSuccess: () => invalidate(projectId),
  });
}

export function useResolveInbox(projectId: string) {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (params: { itemId: string; action: 'RESOLVED' | 'DISMISSED'; note?: string }) =>
      api(`/api/projects/${projectId}/inbox/${params.itemId}/resolve`, {
        method: 'POST',
        body: { action: params.action, note: params.note },
      }),
    onSuccess: () => invalidate(projectId),
  });
}

export function useLinkInboxFeature(projectId: string) {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (params: { itemId: string; featureId: string }) =>
      api(`/api/projects/${projectId}/inbox/${params.itemId}/link-feature`, {
        method: 'POST',
        body: { featureId: params.featureId },
      }),
    onSuccess: () => invalidate(projectId),
  });
}

export function useCreateToken(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string }) =>
      api<{ token: McpTokenDto }>(`/api/projects/${projectId}/mcp-tokens`, {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['mcp-tokens', projectId] }),
  });
}

export function useRevokeToken(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) =>
      api(`/api/projects/${projectId}/mcp-tokens/${tokenId}/revoke`, { method: 'POST' }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['mcp-tokens', projectId] }),
  });
}

export function useConnectRepo(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      owner: string;
      name: string;
      defaultBranch: string;
      installationId?: string | null;
    }) => api(`/api/projects/${projectId}/github/connect`, { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useSimulateGithub(projectId: string) {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (scenario: string) =>
      api(`/api/projects/${projectId}/demo/github/simulate`, {
        method: 'POST',
        body: { scenario },
      }),
    onSuccess: () => invalidate(projectId),
  });
}
