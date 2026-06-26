import type {
  AuditReviewListItem,
  SupportElevationStatus,
  SupportElevationStatusView,
} from '@sovereign/contracts';

export type SupportElevationStatusPanel = {
  title: 'Support Elevation';
  statusLabel: string;
  contentAccessLabel: string;
  reason: string | null;
  expiresAt: string | null;
  grantAction: SupportElevationAction | null;
  revokeAction: SupportElevationAction | null;
};

export type SupportElevationAction = {
  label: string;
  destructive: boolean;
};

export type SupportElevationTimelineRow = {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
};

export function buildSupportElevationStatusPanel(
  status: SupportElevationStatusView,
): SupportElevationStatusPanel {
  const active = status.status === 'active';

  return {
    title: 'Support Elevation',
    statusLabel: statusLabel(status.status),
    contentAccessLabel:
      status.contentAccess === 'elevated'
        ? 'Temporarily elevated'
        : 'No content access',
    reason: status.reason ?? null,
    expiresAt: status.expiresAt ?? null,
    grantAction: active
      ? null
      : {
          label: 'Grant controlled elevation',
          destructive: false,
        },
    revokeAction: active
      ? {
          label: 'Revoke elevation',
          destructive: true,
        }
      : null,
  };
}

export function buildSupportElevationTimelineRow(
  event: Pick<AuditReviewListItem, 'id' | 'type' | 'occurredAt' | 'actorId'>,
): SupportElevationTimelineRow {
  return {
    id: event.id,
    title: eventTitle(event.type),
    detail: event.actorId === undefined ? 'System action' : `Actor ${event.actorId}`,
    timestamp: event.occurredAt,
  };
}

function statusLabel(status: SupportElevationStatus): string {
  switch (status) {
    case 'not_elevated':
      return 'Not elevated';
    case 'pending':
      return 'Pending';
    case 'active':
      return 'Active';
    case 'revoked':
      return 'Revoked';
  }
}

function eventTitle(type: AuditReviewListItem['type']): string {
  switch (type) {
    case 'support.elevation_requested':
      return 'Support elevation requested';
    case 'support.elevation_granted':
      return 'Support elevation granted';
    case 'support.elevation_revoked':
      return 'Support elevation revoked';
    default:
      return type;
  }
}
