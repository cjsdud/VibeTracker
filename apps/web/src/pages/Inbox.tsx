import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { FeatureNodeDto, InboxItemDto, ProjectDto } from '@vibetrack/shared';
import {
  useFeatureTree,
  useInbox,
  useLinkInboxFeature,
  useProposalAction,
  useResolveInbox,
} from '../api/hooks.js';

const typeLabels: Record<string, string> = {
  FEATURE_MAP_REVIEW: '기능 지도 검토',
  STRUCTURE_PROPOSAL: '구조 변경 제안',
  UNTRACKED_CHANGE: '추적되지 않은 변경',
  EVIDENCE_MISMATCH: '기록 불일치',
  TEST_FAILURE: '테스트 실패',
};

const proposalTypeLabels: Record<string, string> = {
  CREATE: '새 기능',
  RETIRE: '기능 종료',
  RENAME: '이름 변경',
  MOVE: '이동',
  MERGE: '병합',
  SPLIT: '분리',
  REPLACE: '대체',
};

function flattenTree(nodes: FeatureNodeDto[], depth = 0): { id: string; label: string }[] {
  return nodes.flatMap((n) => [
    { id: n.id, label: `${' '.repeat(depth * 2)}${n.name}` },
    ...flattenTree(n.children, depth + 1),
  ]);
}

function InboxCard({ project, item }: { project: ProjectDto; item: InboxItemDto }) {
  const proposalAction = useProposalAction(project.id);
  const resolve = useResolveInbox(project.id);
  const link = useLinkInboxFeature(project.id);
  const tree = useFeatureTree(project.id);
  const [linkTarget, setLinkTarget] = useState('');

  const detail = (item.detail ?? {}) as {
    changedFiles?: string[];
    hint?: string;
    declaredFiles?: string[];
    actualFiles?: string[];
    summary?: string | null;
    qualityWarnings?: string[];
    qualityWarningCount?: number;
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <span
            className={`badge ${item.type === 'TEST_FAILURE' ? 'broken' : item.type === 'STRUCTURE_PROPOSAL' || item.type === 'FEATURE_MAP_REVIEW' ? 'awaiting-approval' : 'needs-verification'}`}
          >
            {typeLabels[item.type] ?? item.type}
          </span>
          <div className="title" style={{ fontWeight: 700, marginTop: 8 }}>
            {item.title}
          </div>
        </div>
        <div className="meta" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {new Date(item.createdAt).toLocaleString('ko-KR')}
        </div>
      </div>

      {item.changeProposal && (
        <div style={{ marginTop: 8 }}>
          <p style={{ margin: '4px 0', color: 'var(--text-muted)' }}>
            {item.changeProposal.reason}
          </p>
          <div className="chip-list" style={{ margin: '8px 0' }}>
            <span className="chip">유형: {proposalTypeLabels[item.changeProposal.type]}</span>
            {item.changeProposal.targetFeatureNames.map((name) => (
              <span key={name} className="chip">
                대상: {name}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              className="btn primary small"
              disabled={proposalAction.isPending}
              onClick={() =>
                proposalAction.mutate({ proposalId: item.changeProposal!.id, action: 'approve' })
              }
            >
              승인
            </button>
            <button
              className="btn danger small"
              disabled={proposalAction.isPending}
              onClick={() =>
                proposalAction.mutate({ proposalId: item.changeProposal!.id, action: 'reject' })
              }
            >
              거절
            </button>
          </div>
          {proposalAction.isError && (
            <div className="alert error" style={{ marginTop: 8 }}>
              {proposalAction.error.message}
            </div>
          )}
        </div>
      )}

      {item.type === 'FEATURE_MAP_REVIEW' && (
        <div style={{ marginTop: 10 }}>
          {(detail.qualityWarnings?.length ?? 0) > 0 && (
            <div className="alert info" style={{ marginBottom: 8, fontSize: 13.5 }}>
              <strong>지도 품질 참고 {detail.qualityWarningCount ?? detail.qualityWarnings!.length}건</strong>{' '}
              — 마음에 들지 않으면 Claude Code에 다시 만들어 달라고 하세요.
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {detail.qualityWarnings!.slice(0, 5).map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {(detail.qualityWarningCount ?? 0) > 5 && (
                  <li>외 {(detail.qualityWarningCount ?? 0) - 5}건</li>
                )}
              </ul>
            </div>
          )}
          <Link className="btn primary small" to="/features">
            기능 지도에서 검토하기
          </Link>
        </div>
      )}

      {(detail.changedFiles?.length ?? 0) > 0 && (
        <div className="detail-section" style={{ marginTop: 10 }}>
          <h3>변경 파일</h3>
          <div className="chip-list">
            {detail.changedFiles!.slice(0, 10).map((f) => (
              <span key={f} className="chip">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
      {detail.declaredFiles && (
        <div className="detail-section" style={{ marginTop: 10 }}>
          <h3>기록된 파일 vs 실제 커밋 파일</h3>
          <div className="chip-list">
            {detail.declaredFiles.slice(0, 6).map((f) => (
              <span key={`d-${f}`} className="chip">
                기록: {f}
              </span>
            ))}
            {detail.actualFiles?.slice(0, 6).map((f) => (
              <span key={`a-${f}`} className="chip">
                실제: {f}
              </span>
            ))}
          </div>
        </div>
      )}
      {detail.hint && (
        <div className="alert info" style={{ marginTop: 8 }}>
          {detail.hint}
        </div>
      )}

      {item.type !== 'STRUCTURE_PROPOSAL' && item.type !== 'FEATURE_MAP_REVIEW' && (
        <div
          style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}
        >
          {item.type === 'UNTRACKED_CHANGE' && (
            <>
              <select
                value={linkTarget}
                onChange={(e) => setLinkTarget(e.target.value)}
                style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)' }}
              >
                <option value="">기능에 연결…</option>
                {flattenTree(tree.data?.tree ?? []).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                className="btn primary small"
                disabled={!linkTarget || link.isPending}
                onClick={() => link.mutate({ itemId: item.id, featureId: linkTarget })}
              >
                연결
              </button>
            </>
          )}
          <button
            className="btn small"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ itemId: item.id, action: 'RESOLVED' })}
          >
            확인 완료
          </button>
          <button
            className="btn small"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ itemId: item.id, action: 'DISMISSED' })}
          >
            무시
          </button>
          {(resolve.isError || link.isError) && (
            <div className="alert error">{resolve.error?.message ?? link.error?.message}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function InboxPage({ project }: { project: ProjectDto }) {
  const inbox = useInbox(project.id);
  const items = inbox.data?.items ?? [];

  return (
    <>
      <h1 className="page-title">Inbox</h1>
      <p className="page-desc">
        사용자의 확인이 필요한 것만 모았습니다. 구조 변경은 여기서 승인해야 반영됩니다.
      </p>
      {inbox.isLoading ? (
        <div className="card empty">불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="card empty">확인할 항목이 없습니다. 🎉</div>
      ) : (
        items.map((item) => <InboxCard key={item.id} project={project} item={item} />)
      )}
    </>
  );
}
