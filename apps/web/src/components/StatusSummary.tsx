import {
  displayStatusDescriptionKo,
  displayStatusLabelKo,
  summarizeFeatures,
  summaryOrder,
  type DisplayStatus,
  type FeatureNodeDto,
  type StatusSummary,
} from '@vibetrack/shared';

export const statusColor: Record<DisplayStatus, string> = {
  IMPLEMENTED: 'var(--green)',
  NEEDS_VERIFICATION: '#e0a30b',
  IN_PROGRESS: 'var(--accent)',
  PLANNED: '#c3cad4',
  BROKEN: 'var(--red)',
  AWAITING_APPROVAL: 'var(--purple)',
  RETIRED: '#9aa4b1',
};

/** 상태별 개수를 폭으로 표현하는 분할 막대. 퍼센트 숫자는 쓰지 않는다. */
export function SegBar({ summary, height = 10 }: { summary: StatusSummary; height?: number }) {
  if (summary.total === 0) return null;
  return (
    <div className="seg-bar" style={{ height }}>
      {summaryOrder
        .filter((key) => summary.counts[key] > 0)
        .map((key) => (
          <div
            key={key}
            title={`${displayStatusLabelKo[key]} ${summary.counts[key]}개 — ${displayStatusDescriptionKo[key]}`}
            style={{ flex: summary.counts[key], background: statusColor[key] }}
          />
        ))}
    </div>
  );
}

/** "완성 12 · 검증 필요 4 · …" 형태의 색점 달린 개수 요약 */
export function SummaryChips({ summary }: { summary: StatusSummary }) {
  return (
    <div className="chip-list" style={{ marginTop: 10 }}>
      {summaryOrder
        .filter((key) => summary.counts[key] > 0)
        .map((key) => (
          <span key={key} className="chip" title={displayStatusDescriptionKo[key]}>
            <span className="legend-dot" style={{ background: statusColor[key] }} />
            {displayStatusLabelKo[key]} {summary.counts[key]}
          </span>
        ))}
    </div>
  );
}

/** 영역(부모) 노드 옆에 붙는 소형 요약: 미니 막대 + "완성 x/y" */
export function SubtreeRollup({ node }: { node: FeatureNodeDto }) {
  const summary = summarizeFeatures(node.children);
  if (summary.total === 0) return null;
  return (
    <span className="rollup" title={`하위 기능 ${summary.total}개 중 완성 ${summary.done}개`}>
      <span className="rollup-bar">
        <SegBar summary={summary} height={6} />
      </span>
      <span className="rollup-text">
        완성 {summary.done}/{summary.total}
      </span>
    </span>
  );
}

/** 상태가 무슨 뜻인지 설명하는 범례 */
export function StatusLegend() {
  const keys: DisplayStatus[] = [
    'IMPLEMENTED',
    'NEEDS_VERIFICATION',
    'IN_PROGRESS',
    'PLANNED',
    'BROKEN',
  ];
  return (
    <details className="legend-details">
      <summary>상태가 무슨 뜻인가요?</summary>
      <ul className="legend-list">
        {keys.map((key) => (
          <li key={key}>
            <span className="legend-dot" style={{ background: statusColor[key] }} />
            <b>{displayStatusLabelKo[key]}</b> — {displayStatusDescriptionKo[key]}
          </li>
        ))}
      </ul>
    </details>
  );
}
