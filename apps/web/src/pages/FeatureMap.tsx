import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  displayStatusActionKo,
  displayStatusDescriptionKo,
  displayStatusLabelKo,
  summarizeFeatures,
  type ChangeSource,
  type FeatureDetailDto,
  type FeatureNodeDto,
  type ProjectDto,
} from '@vibetrack/shared';
import {
  useApproveFeatureMap,
  useFeatureDetail,
  useFeatureTree,
  useInbox,
  useUpdateFeature,
} from '../api/hooks.js';
import { AxisBadges, StatusBadge } from '../components/StatusBadge.js';
import {
  SegBar,
  StatusLegend,
  SubtreeRollup,
  SummaryChips,
  statusColor,
} from '../components/StatusSummary.js';

/** 트리에서 id로 노드를 찾는다 (영역/기능 구분에 사용) */
function findNode(nodes: FeatureNodeDto[], id: string): FeatureNodeDto | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

const sourceLabelKo: Record<ChangeSource, string> = {
  GITHUB_WEBHOOK: 'GitHub에서 자동 갱신',
  MCP_RECORD: 'Claude Code 기록',
  USER_MANUAL: '사용자가 직접 수정',
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

/* ---------- 왼쪽: 영역 카드 지도 ---------- */

function FeatureRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: FeatureNodeDto;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const retired = node.lifecycle === 'RETIRED';
  const liveChildren = node.children.filter((c) => c.lifecycle !== 'RETIRED');
  return (
    <>
      <div
        className={`feature-row ${selectedId === node.id ? 'selected' : ''}`}
        style={{ marginLeft: (depth - 1) * 18 }}
        onClick={() => onSelect(node.id)}
      >
        <span
          className="status-dot"
          style={{ background: statusColor[node.displayStatus] }}
          title={displayStatusLabelKo[node.displayStatus]}
        />
        <div className="row-main">
          <div className="row-name">
            {node.isCore && (
              <span className="core-mark" title="핵심 기능">
                ★
              </span>
            )}
            <span
              style={
                retired ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : undefined
              }
            >
              {node.name}
            </span>
          </div>
          {node.description && <div className="row-desc">{node.description}</div>}
        </div>
        <span className="row-side">
          {liveChildren.length > 0 ? (
            <SubtreeRollup node={node} />
          ) : (
            <StatusBadge status={node.displayStatus} />
          )}
        </span>
      </div>
      {node.children.map((child) => (
        <FeatureRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function AreaCard({
  area,
  selectedId,
  onSelect,
}: {
  area: FeatureNodeDto;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const retired = area.lifecycle === 'RETIRED';
  const hasChildren = area.children.length > 0;
  // 살아있는 자식이 있어야 롤업이 의미가 있다 — 전부 종료됐으면 영역 자신의 상태를 보여준다
  const hasLiveChildren = area.children.some((c) => c.lifecycle !== 'RETIRED');
  return (
    <div className={`card area-card ${selectedId === area.id ? 'area-selected' : ''}`}>
      <div className="area-head" onClick={() => onSelect(area.id)}>
        <span className="area-title">
          {area.isCore && (
            <span className="core-mark" title="핵심 영역">
              ★{' '}
            </span>
          )}
          <span
            style={
              retired ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : undefined
            }
          >
            {area.name}
          </span>
        </span>
        {hasLiveChildren ? (
          <SubtreeRollup node={area} />
        ) : (
          <StatusBadge status={area.displayStatus} />
        )}
      </div>
      {area.description && (
        <p className="area-desc" onClick={() => onSelect(area.id)}>
          {area.description}
        </p>
      )}
      {hasChildren && (
        <div className="feature-rows">
          {area.children.map((child) => (
            <FeatureRow
              key={child.id}
              node={child}
              depth={1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 오른쪽: 기능 상세 ---------- */

interface TimelineEvent {
  at: string;
  color: string;
  title: string;
  sub?: string;
}

/** 작업 기록·테스트·커밋·PR·등록 시점을 하나의 시간순 히스토리로 합친다 */
function buildTimeline(feature: FeatureDetailDto): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const work of feature.workUpdates) {
    events.push({
      at: work.createdAt,
      color: 'var(--accent)',
      title: work.summary,
      sub:
        work.testsStatus === 'PASSED'
          ? '테스트 통과'
          : work.testsStatus === 'FAILED'
            ? '테스트 실패'
            : work.manualCheck
              ? '실사용 확인'
              : undefined,
    });
  }
  for (const run of feature.verificationRuns) {
    // MCP 테스트 결과는 위 작업 기록에 이미 표시되므로 CI/수동 확인만 별도 이벤트로
    if (run.source === 'MCP') continue;
    events.push({
      at: run.createdAt,
      color: run.status === 'PASSED' ? 'var(--green)' : 'var(--red)',
      title:
        run.status === 'PASSED'
          ? `테스트 통과${run.name ? ` — ${run.name}` : ''}`
          : `테스트 실패${run.name ? ` — ${run.name}` : ''}`,
    });
  }
  for (const evidence of feature.evidence) {
    // 작업 기록에서 나온 커밋 증거는 그 작업 기록이 이미 대표한다 — 중복 표시하지 않는다.
    // (소급 기록의 증거 행은 생성 시각이라 "방금 전"으로 잘못 정렬되는 문제도 함께 막는다)
    if (evidence.workUpdateId) continue;
    if (evidence.type === 'COMMIT') {
      events.push({
        at: evidence.createdAt,
        color: '#9aa4b1',
        title: `커밋 ${evidence.ref?.slice(0, 7) ?? ''}${evidence.title ? ` · ${evidence.title}` : ''}`,
      });
    } else if (evidence.type === 'PULL_REQUEST') {
      events.push({
        at: evidence.createdAt,
        color: 'var(--purple)',
        title: `PR #${evidence.ref}${evidence.title ? ` · ${evidence.title}` : ''}`,
      });
    }
  }
  events.push({
    at: feature.node.createdAt,
    color: 'var(--purple)',
    title: '기능 지도에 등록됨',
  });
  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function HistoryTimeline({ events }: { events: TimelineEvent[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? events : events.slice(0, 10);
  return (
    <>
      <ul className="htl">
        {visible.map((event, i) => (
          <li key={`${event.at}-${i}`}>
            <span className="h-dot" style={{ background: event.color }} />
            <div className="h-title">
              {event.title}
              {event.sub && <span className="h-sub"> · {event.sub}</span>}
            </div>
            <div className="h-time" title={new Date(event.at).toLocaleString('ko-KR')}>
              {formatWhen(event.at)}
            </div>
          </li>
        ))}
      </ul>
      {events.length > visible.length && (
        <button className="btn small" onClick={() => setShowAll(true)}>
          이전 기록 {events.length - visible.length}개 더 보기
        </button>
      )}
    </>
  );
}

function VerifyActions({ project, feature }: { project: ProjectDto; feature: FeatureDetailDto }) {
  const update = useUpdateFeature(project.id);
  const [copied, setCopied] = useState(false);
  const node = feature.node;
  if (node.lifecycle !== 'ACTIVE') return null;
  // 검증 액션은 "확인이 필요한/끝난" 상태에서만 의미가 있다 (계획됨·작업 중에는 숨김)
  const relevant =
    node.displayStatus === 'NEEDS_VERIFICATION' ||
    node.displayStatus === 'BROKEN' ||
    node.displayStatus === 'IMPLEMENTED';
  if (!relevant) return null;

  const verifyPrompt = `VibeTrack 기능 "${node.name}"(featureId: ${node.id})을 검증해줘. 테스트를 실행하거나 실제 동작을 확인한 뒤, record_work_update에 featureIds=["${node.id}"]와 tests 또는 manualCheck 결과를 기록해줘.`;
  const copyPrompt = () => {
    void navigator.clipboard.writeText(verifyPrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const broken = node.displayStatus === 'BROKEN';
  const needsCheck = node.displayStatus === 'NEEDS_VERIFICATION' || broken;
  // "완성으로 표시" 약속을 지키기 위해, 구현 축이 미완이면 구현됨도 함께 기록한다
  const markVerified = () =>
    update.mutate({
      featureId: node.id,
      verificationStatus: 'MANUAL_VERIFIED',
      ...(node.implementationStatus === 'PARTIAL' || node.implementationStatus === 'NOT_STARTED'
        ? { implementationStatus: 'IMPLEMENTED' as const }
        : {}),
    });

  return (
    <div className="detail-section">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {needsCheck && (
          <button
            // 문제 있음(테스트 실패)을 한 클릭으로 덮지 않도록, 실패 상태에서는 눈에 덜 띄는 버튼으로
            className={broken ? 'btn small' : 'btn primary small'}
            disabled={update.isPending}
            onClick={markVerified}
          >
            {update.isPending
              ? '저장 중…'
              : broken
                ? '문제가 해결된 걸 직접 확인했어요 — 완성으로 표시'
                : '직접 확인했어요 — 완성으로 표시'}
          </button>
        )}
        {node.displayStatus === 'IMPLEMENTED' && (
          <button
            className="btn small"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({ featureId: node.id, verificationStatus: 'NEEDS_VERIFICATION' })
            }
          >
            아직인 것 같아요 — 검증 필요로 되돌리기
          </button>
        )}
        <button className="btn small" onClick={copyPrompt}>
          {copied ? '복사됨 ✓' : 'Claude Code 검증 요청 프롬프트 복사'}
        </button>
      </div>
      {needsCheck && (
        <p style={{ color: 'var(--text-muted)', fontSize: 12.5, margin: '6px 0 0' }}>
          {broken
            ? '최근 테스트가 실패한 기능입니다. 직접 실행해서 문제가 해결된 걸 확인한 경우에만 완성으로 표시하세요.'
            : '직접 실행해서 잘 동작하는 걸 확인했을 때만 누르세요. Claude Code에게 시키려면 프롬프트를 복사해 붙여넣으면 됩니다.'}
        </p>
      )}
      {update.isError && (
        <div className="alert error" style={{ marginTop: 8 }}>
          {update.error.message}
        </div>
      )}
    </div>
  );
}

function FeatureDetail({
  project,
  featureId,
  treeNode,
}: {
  project: ProjectDto;
  featureId: string;
  treeNode: FeatureNodeDto | null;
}) {
  const detail = useFeatureDetail(project.id, featureId);
  const feature = detail.data?.feature;
  const timeline = useMemo(() => (feature ? buildTimeline(feature) : []), [feature]);
  // 영역(살아있는 하위 기능이 있는 노드)은 자기 상태 대신 하위 요약을 보여준다
  const liveChildren = treeNode?.children.filter((c) => c.lifecycle !== 'RETIRED') ?? [];
  const isArea = liveChildren.length > 0;
  const areaSummary = isArea ? summarizeFeatures(treeNode!.children) : null;
  if (detail.isLoading) return <div className="card feature-detail-anchor">불러오는 중…</div>;
  if (!feature)
    return <div className="card empty feature-detail-anchor">기능을 찾을 수 없습니다.</div>;

  const evidenceByType = (types: string[]) =>
    feature.evidence.filter((e) => types.includes(e.type));
  const files = evidenceByType(['FILE', 'DOCUMENT']);
  const routes = evidenceByType(['ROUTE', 'API_ENDPOINT']);
  const tests = evidenceByType(['TEST']);
  const staticEvidenceCount = files.length + routes.length + tests.length;

  return (
    <div className="card feature-detail-anchor">
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
        {isArea && areaSummary ? (
          <span className="rollup-text" style={{ fontWeight: 700 }}>
            완성 {areaSummary.done}/{areaSummary.total}
          </span>
        ) : (
          <StatusBadge status={feature.node.displayStatus} />
        )}
      </div>
      {feature.node.description && (
        <p style={{ color: 'var(--text-muted)' }}>{feature.node.description}</p>
      )}

      {isArea && areaSummary ? (
        // 영역: 자기 자신의 상태가 아니라 하위 기능들의 집계가 곧 상태다
        <div style={{ marginBottom: 12 }}>
          <SegBar summary={areaSummary} />
          <SummaryChips summary={areaSummary} />
          <p style={{ color: 'var(--text-muted)', fontSize: 12.5, margin: '6px 0 0' }}>
            하위 기능 {areaSummary.total}개를 묶는 영역입니다. 상태는 하위 기능에서 관리하세요.
          </p>
        </div>
      ) : (
        <>
          <div className="alert info" style={{ fontSize: 13.5 }}>
            <b>{displayStatusLabelKo[feature.node.displayStatus]}</b> —{' '}
            {displayStatusDescriptionKo[feature.node.displayStatus]}
            {displayStatusActionKo[feature.node.displayStatus] && (
              <>
                <br />→ {displayStatusActionKo[feature.node.displayStatus]}
              </>
            )}
          </div>
          <VerifyActions project={project} feature={feature} />
        </>
      )}

      {feature.branchActivities.length > 0 && (
        <div className="detail-section">
          <h3>작업 중인 변경 (아직 main 미반영)</h3>
          {feature.branchActivities.map((activity) => (
            <div className="branch-activity" key={activity.id}>
              <div>
                <span className="chip">{activity.branch}</span>
                {activity.prNumber && (
                  <span className="chip" style={{ marginLeft: 4 }}>
                    PR #{activity.prNumber}
                    {activity.prState ? ` · ${activity.prState}` : ''}
                  </span>
                )}
                {activity.ciFailed && (
                  <span className="badge broken" style={{ marginLeft: 4 }}>
                    CI 실패
                  </span>
                )}
              </div>
              {activity.summary && (
                <div style={{ fontSize: 13, marginTop: 4 }}>{activity.summary}</div>
              )}
              <div className="meta" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {formatWhen(activity.updatedAt)} · PR이 main에 합쳐지면 이 기능의 공식 상태로
                반영됩니다
              </div>
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

      <div className="detail-section">
        <h3>만들어져 온 과정</h3>
        {timeline.length > 1 ? (
          // key: 기능 전환 시 "더 보기" 펼침 상태가 새 기능으로 새어가지 않도록
          <HistoryTimeline key={feature.node.id} events={timeline} />
        ) : (
          <div className="empty" style={{ padding: '8px 0' }}>
            아직 기록이 없습니다 — Claude Code로 작업하면 여기에 자동으로 쌓입니다.
          </div>
        )}
      </div>

      {staticEvidenceCount > 0 && (
        <details className="legend-details">
          <summary>연결된 파일 · 경로 · 테스트 보기 ({staticEvidenceCount})</summary>
          {files.length > 0 && (
            <div className="detail-section" style={{ marginTop: 8 }}>
              <h3>파일</h3>
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
            <div className="detail-section" style={{ marginTop: 8 }}>
              <h3>화면 / 주소</h3>
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
            <div className="detail-section" style={{ marginTop: 8 }}>
              <h3>테스트</h3>
              <div className="chip-list">
                {tests.map((e) => (
                  <span key={e.id} className={`chip ${e.missing ? 'missing' : ''}`}>
                    {e.path}
                  </span>
                ))}
              </div>
            </div>
          )}
        </details>
      )}

      {feature.relatedProposals.length > 0 && (
        <div className="detail-section" style={{ marginTop: 10 }}>
          <h3>관련 구조 변경 제안</h3>
          {feature.relatedProposals.map((p) => (
            <div className="list-item" key={p.id}>
              <div>
                <div className="title">{p.title}</div>
                <div className="meta">
                  {p.status === 'PENDING'
                    ? '승인 대기 — 확인함(Inbox)에서 승인/거절'
                    : p.status === 'APPROVED'
                      ? '승인됨'
                      : '거절됨'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="legend-details" style={{ marginTop: 10 }}>
        <summary>상세 상태 (3축)</summary>
        <div style={{ marginTop: 8 }}>
          <AxisBadges
            lifecycle={feature.node.lifecycle}
            implementationStatus={feature.node.implementationStatus}
            verificationStatus={feature.node.verificationStatus}
          />
          {feature.node.lastStatusSource && (
            <div className="meta" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              마지막 상태 변경: {sourceLabelKo[feature.node.lastStatusSource]}
              {feature.node.lastChangedAt ? ` · ${formatWhen(feature.node.lastChangedAt)}` : ''}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/* ---------- 페이지 ---------- */

export function FeatureMapPage({ project }: { project: ProjectDto }) {
  const { featureId } = useParams<{ featureId: string }>();
  const navigate = useNavigate();
  const tree = useFeatureTree(project.id);
  const approve = useApproveFeatureMap(project.id);
  const inbox = useInbox(project.id);

  const nodes = tree.data?.tree ?? [];
  const hasLifecycle = (list: FeatureNodeDto[], lifecycle: string): boolean =>
    list.some((n) => n.lifecycle === lifecycle || hasLifecycle(n.children, lifecycle));
  const draftMode = hasLifecycle(nodes, 'DRAFT');
  const replaceMode = draftMode && hasLifecycle(nodes, 'ACTIVE');

  // 교체 검토 중에는 초안 지도와 현재 지도를 섞지 않고 구분해서 보여준다
  const draftRoots = nodes.filter((n) => n.lifecycle === 'DRAFT');
  const otherRoots = nodes.filter((n) => n.lifecycle !== 'DRAFT');

  // 검토 항목의 등록 시각·기능 수·품질 경고 — "Claude가 아직 작업 중일 수 있다"를 보여주기 위한 정보
  const reviewItem = inbox.data?.items.find((i) => i.type === 'FEATURE_MAP_REVIEW');
  const reviewDetail = (reviewItem?.detail ?? {}) as {
    draftCount?: number;
    qualityWarningCount?: number;
  };
  const registeredMinutesAgo = reviewItem
    ? Math.floor((Date.now() - new Date(reviewItem.createdAt).getTime()) / 60_000)
    : null;

  // 모바일(한 열 레이아웃)에서는 기능 선택 시 상세로 스크롤
  useEffect(() => {
    if (featureId && window.matchMedia('(max-width: 900px)').matches) {
      document.querySelector('.feature-detail-anchor')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [featureId]);

  const onSelect = (id: string) => navigate(`/features/${id}`);

  return (
    <>
      <h1 className="page-title">기능 지도</h1>
      <p className="page-desc">
        파일이 아니라 사용자 눈높이의 기능 목록입니다. 기능을 누르면 상태와 만들어져 온 과정을 볼
        수 있습니다.
      </p>
      <StatusLegend />

      {draftMode && (
        <div className="card" style={{ borderColor: 'var(--purple)', borderWidth: 2 }}>
          <h2>{replaceMode ? '새 기능 지도 검토 (교체)' : '초기 기능 지도 검토'}</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
            {replaceMode
              ? 'Claude Code가 새 기능 지도 초안을 등록했습니다. 승인하면 기존 지도 전체가 종료 처리되고(기록은 보존) 이 초안이 새 지도가 됩니다.'
              : 'Claude Code가 만든 기능 지도 초안입니다. 승인하면 활성화되고 이후 작업이 자동으로 추적됩니다. 마음에 들지 않으면 Claude Code에서 bootstrap을 다시 실행해 초안을 교체할 수 있습니다.'}
          </p>
          {reviewItem && (
            <div className="chip-list" style={{ marginBottom: 10 }}>
              <span className="chip">기능 {reviewDetail.draftCount ?? '?'}개</span>
              <span className="chip">
                {registeredMinutesAgo === 0
                  ? '방금 전 등록'
                  : registeredMinutesAgo !== null && registeredMinutesAgo < 60
                    ? `${registeredMinutesAgo}분 전 등록`
                    : `${new Date(reviewItem.createdAt).toLocaleString('ko-KR')} 등록`}
              </span>
              {(reviewDetail.qualityWarningCount ?? 0) > 0 && (
                <span className="chip">품질 참고 {reviewDetail.qualityWarningCount}건</span>
              )}
            </div>
          )}
          <div className="alert info" style={{ fontSize: 13.5, marginBottom: 10 }}>
            승인 버튼이 떠 있어도 Claude Code가 아직 작업 중일 수 있습니다 — 품질 지적을 고쳐
            초안을 다시 등록하거나(이 초안이 교체됩니다) 기능마다 지난 히스토리를 연결하는 중일 수
            있어요. Claude Code가 <strong>&quot;등록을 마쳤으니 승인해 주세요&quot;</strong>라고
            알린 뒤에 승인하는 것을 권장합니다.
          </div>
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
        <div className="map-column">
          {tree.isLoading ? (
            <div className="card empty">불러오는 중…</div>
          ) : nodes.length === 0 ? (
            <div className="card empty">
              아직 기능 지도가 없습니다.
              <br />
              설정의 Claude Code 연결 안내에서 bootstrap 프롬프트를 실행하세요.
            </div>
          ) : (
            <>
              {replaceMode && draftRoots.length > 0 && (
                <div className="map-section-title">승인 대기 초안 — 새 지도</div>
              )}
              {draftRoots.map((area) => (
                <AreaCard
                  key={area.id}
                  area={area}
                  selectedId={featureId ?? null}
                  onSelect={onSelect}
                />
              ))}
              {replaceMode && otherRoots.length > 0 && (
                <div className="map-section-title">현재 지도 — 초안을 승인하면 종료됩니다</div>
              )}
              {otherRoots.map((area) => (
                <AreaCard
                  key={area.id}
                  area={area}
                  selectedId={featureId ?? null}
                  onSelect={onSelect}
                />
              ))}
            </>
          )}
        </div>
        {featureId ? (
          <FeatureDetail
            project={project}
            featureId={featureId}
            treeNode={findNode(nodes, featureId)}
          />
        ) : (
          <div className="card empty">기능을 선택하면 상태와 히스토리가 표시됩니다.</div>
        )}
      </div>
    </>
  );
}
