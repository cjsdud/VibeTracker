import type { ProjectDto } from '@vibetrack/shared';
import { useActivity } from '../api/hooks.js';

const kindLabels: Record<string, { label: string; className: string }> = {
  WORK_UPDATE: { label: 'Claude Code', className: 'in-progress' },
  GITHUB_EVENT: { label: 'GitHub', className: 'planned' },
  VERIFICATION_RUN: { label: '테스트', className: 'implemented' },
  AUDIT: { label: '승인', className: 'awaiting-approval' },
};

export function ActivityPage({ project }: { project: ProjectDto }) {
  const activity = useActivity(project.id);
  const items = activity.data?.items ?? [];

  return (
    <>
      <h1 className="page-title">활동 기록</h1>
      <p className="page-desc">프로젝트에서 실제로 일어난 일을 시간순으로 보여줍니다.</p>
      <div className="card">
        {activity.isLoading ? (
          <div className="empty">불러오는 중…</div>
        ) : items.length === 0 ? (
          <div className="empty">아직 활동이 없습니다.</div>
        ) : (
          items.map((item) => {
            const kind = kindLabels[item.kind] ?? { label: item.kind, className: 'planned' };
            return (
              <div className="list-item" key={item.id}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span className={`badge ${kind.className}`}>{kind.label}</span>
                  <div>
                    <div className="title" style={{ fontWeight: 600 }}>
                      {item.title}
                    </div>
                    {item.detail && <div className="meta">{item.detail}</div>}
                  </div>
                </div>
                <div className="meta">{new Date(item.createdAt).toLocaleString('ko-KR')}</div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
