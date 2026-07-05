import {
  displayStatusLabelKo,
  implementationLabelKo,
  lifecycleLabelKo,
  verificationLabelKo,
  type DisplayStatus,
  type ImplementationStatus,
  type Lifecycle,
  type VerificationStatus,
} from '@vibetrack/shared';

const classByStatus: Record<DisplayStatus, string> = {
  PLANNED: 'planned',
  IN_PROGRESS: 'in-progress',
  IMPLEMENTED: 'implemented',
  NEEDS_VERIFICATION: 'needs-verification',
  BROKEN: 'broken',
  AWAITING_APPROVAL: 'awaiting-approval',
  RETIRED: 'retired',
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={`badge ${classByStatus[status]}`}>{displayStatusLabelKo[status]}</span>;
}

export function AxisBadges({
  lifecycle,
  implementationStatus,
  verificationStatus,
}: {
  lifecycle: Lifecycle;
  implementationStatus: ImplementationStatus;
  verificationStatus: VerificationStatus;
}) {
  return (
    <div className="chip-list">
      <span className="chip">생명주기: {lifecycleLabelKo[lifecycle]}</span>
      <span className="chip">구현: {implementationLabelKo[implementationStatus]}</span>
      <span className="chip">검증: {verificationLabelKo[verificationStatus]}</span>
    </div>
  );
}
