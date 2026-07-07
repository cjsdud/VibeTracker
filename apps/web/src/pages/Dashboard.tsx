import { Link } from 'react-router-dom';
import { summarizeFeatures, type ProjectDto } from '@vibetrack/shared';
import { useDashboard, useFeatureTree } from '../api/hooks.js';
import { SegBar, SummaryChips } from '../components/StatusSummary.js';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function DashboardPage({ project }: { project: ProjectDto }) {
  const dashboard = useDashboard(project.id);
  const data = dashboard.data;
  const tree = useFeatureTree(project.id);
  const nodes = tree.data?.tree ?? [];
  // 지도 교체 검토 중(초안이 기존 지도와 공존)에는 초안을 요약에서 제외해 이중 집계를 막는다.
  // 첫 온보딩(활성 지도 없음)에는 초안(승인 대기)을 그대로 보여준다.
  const hasActive = nodes.some((n) => n.lifecycle === 'ACTIVE');
  const summary = summarizeFeatures(
    hasActive ? nodes.filter((n) => n.lifecycle !== 'DRAFT') : nodes,
  );

  return (
    <>
      <h1 className="page-title">{project.name}</h1>
      <p className="page-desc">{project.goal ?? '프로젝트 목표가 아직 없습니다.'}</p>

      {data?.counts.draftFeatures ? (
        <div className="alert info">
          승인 대기 중인 기능 지도 초안이 있습니다.{' '}
          <Link to="/features" style={{ fontWeight: 700, textDecoration: 'underline' }}>
            기능 지도에서 검토하기 →
          </Link>
        </div>
      ) : null}

      {data && (
        <div className="card next-task">
          <h2>다음 작업</h2>
          <p className="task">{data.nextTask.task}</p>
          <p className="reason">{data.nextTask.reason}</p>
        </div>
      )}

      {summary.total > 0 && (
        <div className="card">
          <h2>진행 요약</h2>
          <p className="progress-headline">
            전체 {summary.total}개 기능 중 <b>완성 {summary.done}개</b>
            {summary.counts.NEEDS_VERIFICATION > 0 &&
              ` · 검증만 남은 기능 ${summary.counts.NEEDS_VERIFICATION}개`}
          </p>
          <SegBar summary={summary} />
          <SummaryChips summary={summary} />
        </div>
      )}

      <div className="stat-grid">
        <div className="stat">
          <div className="label">핵심 기능</div>
          <div className="value">{data?.counts.coreFeatures ?? '–'}</div>
        </div>
        <div className={`stat ${data && data.counts.needsVerification > 0 ? 'warn' : ''}`}>
          <div className="label">검증 필요</div>
          <div className="value">{data?.counts.needsVerification ?? '–'}</div>
        </div>
        <div className={`stat ${data && data.counts.pendingProposals > 0 ? 'info' : ''}`}>
          <div className="label">승인 대기</div>
          <div className="value">{data?.counts.pendingProposals ?? '–'}</div>
        </div>
        <div className={`stat ${data && data.counts.untrackedChanges > 0 ? 'danger' : ''}`}>
          <div className="label">추적 안 된 변경</div>
          <div className="value">{data?.counts.untrackedChanges ?? '–'}</div>
        </div>
      </div>

      <div className="card">
        <h2>최근 작업</h2>
        {data?.recentWork.length ? (
          data.recentWork.map((work) => (
            <div className="list-item" key={work.id}>
              <div>
                <div className="title">{work.summary}</div>
                <div className="meta">
                  {work.featureNames.length ? work.featureNames.join(', ') : '연결된 기능 없음'}
                  {work.testsStatus === 'PASSED' && ' · 테스트 통과'}
                  {work.testsStatus === 'FAILED' && ' · 테스트 실패'}
                  {work.manualCheck && ' · 실제 사용 확인'}
                </div>
              </div>
              <div className="meta">{timeAgo(work.createdAt)}</div>
            </div>
          ))
        ) : (
          <div className="empty">
            아직 작업 기록이 없습니다. Claude Code에서 작업하면 자동으로 기록됩니다.
          </div>
        )}
      </div>
    </>
  );
}
