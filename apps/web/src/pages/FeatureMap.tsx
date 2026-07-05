import { useNavigate, useParams } from 'react-router-dom';
import type { FeatureNodeDto, ProjectDto } from '@vibetrack/shared';
import { useApproveFeatureMap, useFeatureDetail, useFeatureTree } from '../api/hooks.js';
import { AxisBadges, StatusBadge } from '../components/StatusBadge.js';

function TreeNodes({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: FeatureNodeDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.id}>
          <div
            className={`tree-node ${selectedId === node.id ? 'selected' : ''}`}
            onClick={() => onSelect(node.id)}
          >
            {node.isCore && (
              <span className="core-mark" title="핵심 기능">
                ★
              </span>
            )}
            <span
              className="name"
              style={
                node.lifecycle === 'RETIRED'
                  ? { textDecoration: 'line-through', color: 'var(--text-muted)' }
                  : undefined
              }
            >
              {node.name}
            </span>
            <StatusBadge status={node.displayStatus} />
          </div>
          <TreeNodes nodes={node.children} selectedId={selectedId} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function FeatureDetail({ project, featureId }: { project: ProjectDto; featureId: string }) {
  const detail = useFeatureDetail(project.id, featureId);
  if (detail.isLoading) return <div className="card">불러오는 중…</div>;
  const feature = detail.data?.feature;
  if (!feature) return <div className="card empty">기능을 찾을 수 없습니다.</div>;

  const evidenceByType = (types: string[]) =>
    feature.evidence.filter((e) => types.includes(e.type));
  const files = evidenceByType(['FILE', 'DOCUMENT']);
  const routes = evidenceByType(['ROUTE', 'API_ENDPOINT']);
  const tests = evidenceByType(['TEST']);
  const commits = evidenceByType(['COMMIT']);
  const prs = evidenceByType(['PULL_REQUEST']);

  return (
    <div className="card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 2 }}>
            {feature.node.isCore && <span className="core-mark">★ </span>}
            {feature.node.name}
          </h2>
          {feature.parentName && (
            <div className="meta" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              상위: {feature.parentName}
            </div>
          )}
        </div>
        <StatusBadge status={feature.node.displayStatus} />
      </div>
      {feature.node.description && (
        <p style={{ color: 'var(--text-muted)' }}>{feature.node.description}</p>
      )}

      <div className="detail-section" style={{ marginTop: 10 }}>
        <AxisBadges
          lifecycle={feature.node.lifecycle}
          implementationStatus={feature.node.implementationStatus}
          verificationStatus={feature.node.verificationStatus}
        />
      </div>

      {files.length > 0 && (
        <div className="detail-section">
          <h3>연결된 파일</h3>
          <div className="chip-list">
            {files.map((e) => (
              <span key={e.id} className={`chip ${e.missing ? 'missing' : ''}`}>
                {e.path}
              </span>
            ))}
          </div>
        </div>
      )}
      {routes.length > 0 && (
        <div className="detail-section">
          <h3>라우트 / API</h3>
          <div className="chip-list">
            {routes.map((e) => (
              <span key={e.id} className="chip">
                {e.path}
              </span>
            ))}
          </div>
        </div>
      )}
      {tests.length > 0 && (
        <div className="detail-section">
          <h3>연결된 테스트</h3>
          <div className="chip-list">
            {tests.map((e) => (
              <span key={e.id} className={`chip ${e.missing ? 'missing' : ''}`}>
                {e.path}
              </span>
            ))}
          </div>
        </div>
      )}
      {(commits.length > 0 || prs.length > 0) && (
        <div className="detail-section">
          <h3>커밋 / PR</h3>
          <div className="chip-list">
            {commits.map((e) => (
              <span key={e.id} className="chip" title={e.title ?? undefined}>
                {e.ref?.slice(0, 7)} {e.title ? `· ${e.title.slice(0, 40)}` : ''}
              </span>
            ))}
            {prs.map((e) => (
              <span key={e.id} className="chip">
                PR #{e.ref} {e.title ? `· ${e.title.slice(0, 40)}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {feature.verificationRuns.length > 0 && (
        <div className="detail-section">
          <h3>테스트 결과</h3>
          {feature.verificationRuns.slice(0, 5).map((run) => (
            <div className="list-item" key={run.id}>
              <div>
                <span className={`badge ${run.status === 'PASSED' ? 'implemented' : 'broken'}`}>
                  {run.status === 'PASSED' ? '통과' : '실패'}
                </span>{' '}
                <span style={{ fontSize: 13 }}>{run.name ?? run.source}</span>
              </div>
              <div className="meta">{new Date(run.createdAt).toLocaleString('ko-KR')}</div>
            </div>
          ))}
        </div>
      )}

      {feature.openQuestions.filter((q) => q.status === 'OPEN').length > 0 && (
        <div className="detail-section">
          <h3>미해결 질문</h3>
          {feature.openQuestions
            .filter((q) => q.status === 'OPEN')
            .map((q) => (
              <div key={q.id} className="alert info" style={{ marginBottom: 6 }}>
                {q.question}
              </div>
            ))}
        </div>
      )}

      {feature.relatedProposals.length > 0 && (
        <div className="detail-section">
          <h3>관련 구조 변경 제안</h3>
          {feature.relatedProposals.map((p) => (
            <div className="list-item" key={p.id}>
              <div>
                <div className="title">{p.title}</div>
                <div className="meta">
                  {p.status === 'PENDING'
                    ? '승인 대기'
                    : p.status === 'APPROVED'
                      ? '승인됨'
                      : '거절됨'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="detail-section">
        <h3>작업 기록</h3>
        {feature.workUpdates.length ? (
          <ul className="timeline">
            {feature.workUpdates.map((work) => (
              <li key={work.id}>
                <div className="time">{new Date(work.createdAt).toLocaleString('ko-KR')}</div>
                <div>{work.summary}</div>
                {work.testsStatus && work.testsStatus !== 'NOT_RUN' && (
                  <div className="meta" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    테스트 {work.testsStatus === 'PASSED' ? '통과' : '실패'}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">작업 기록이 없습니다.</div>
        )}
      </div>
    </div>
  );
}

export function FeatureMapPage({ project }: { project: ProjectDto }) {
  const { featureId } = useParams<{ featureId: string }>();
  const navigate = useNavigate();
  const tree = useFeatureTree(project.id);
  const approve = useApproveFeatureMap(project.id);

  const nodes = tree.data?.tree ?? [];
  const hasDraft = (list: FeatureNodeDto[]): boolean =>
    list.some((n) => n.lifecycle === 'DRAFT' || hasDraft(n.children));
  const draftMode = hasDraft(nodes);

  return (
    <>
      <h1 className="page-title">기능 지도</h1>
      <p className="page-desc">
        파일 트리가 아니라 사용자 관점의 기능 트리입니다. 구조 변경은 승인을 거쳐야 반영됩니다.
      </p>

      {draftMode && (
        <div className="card" style={{ borderColor: 'var(--purple)', borderWidth: 2 }}>
          <h2>초기 기능 지도 검토</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
            Claude Code가 만든 기능 지도 초안입니다. 승인하면 활성화되고 이후 작업이 자동으로
            추적됩니다. 마음에 들지 않으면 Claude Code에서 bootstrap을 다시 실행해 초안을 교체할 수
            있습니다.
          </p>
          <button
            className="btn primary"
            disabled={approve.isPending}
            onClick={() => approve.mutate()}
          >
            {approve.isPending ? '승인 중…' : '기능 지도 승인'}
          </button>
          {approve.isError && (
            <div className="alert error" style={{ marginTop: 10 }}>
              {approve.error.message}
            </div>
          )}
        </div>
      )}

      <div className="feature-page">
        <div className="card tree">
          {tree.isLoading ? (
            <div className="empty">불러오는 중…</div>
          ) : nodes.length === 0 ? (
            <div className="empty">
              아직 기능 지도가 없습니다.
              <br />
              설정의 Claude Code 연결 안내에서 bootstrap 프롬프트를 실행하세요.
            </div>
          ) : (
            <TreeNodes
              nodes={nodes}
              selectedId={featureId ?? null}
              onSelect={(id) => navigate(`/features/${id}`)}
            />
          )}
        </div>
        {featureId ? (
          <FeatureDetail project={project} featureId={featureId} />
        ) : (
          <div className="card empty">기능을 선택하면 상세 정보가 표시됩니다.</div>
        )}
      </div>
    </>
  );
}
