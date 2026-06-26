import test from 'node:test';
import assert from 'node:assert/strict';

import type { SupportElevationStatusView } from '@sovereign/contracts';

import {
  buildSupportElevationStatusPanel,
  buildSupportElevationTimelineRow,
} from './support-elevation';

test('builds admin support-elevation status panel without content bypass affordances', () => {
  const active: SupportElevationStatusView = {
    tenantId: 'tenant-1',
    officeId: 'office-1',
    supportUserId: 'support-1',
    status: 'active',
    contentAccess: 'elevated',
    reason: 'Investigate outage',
    grantedBy: 'principal-1',
    expiresAt: '2026-06-26T13:25:00.000Z',
  };

  assert.deepEqual(buildSupportElevationStatusPanel(active), {
    title: 'Support Elevation',
    statusLabel: 'Active',
    contentAccessLabel: 'Temporarily elevated',
    reason: 'Investigate outage',
    expiresAt: '2026-06-26T13:25:00.000Z',
    grantAction: null,
    revokeAction: {
      label: 'Revoke elevation',
      destructive: true,
    },
  });
});

test('builds default-deny support panel and timeline rows', () => {
  const notElevated: SupportElevationStatusView = {
    tenantId: 'tenant-1',
    officeId: 'office-1',
    supportUserId: 'support-1',
    status: 'not_elevated',
    contentAccess: 'denied',
  };

  assert.deepEqual(buildSupportElevationStatusPanel(notElevated), {
    title: 'Support Elevation',
    statusLabel: 'Not elevated',
    contentAccessLabel: 'No content access',
    reason: null,
    expiresAt: null,
    grantAction: {
      label: 'Grant controlled elevation',
      destructive: false,
    },
    revokeAction: null,
  });
  assert.deepEqual(
    buildSupportElevationTimelineRow({
      id: 'event-1',
      type: 'support.elevation_granted',
      occurredAt: '2026-06-26T12:25:00.000Z',
      actorId: 'principal-1',
    }),
    {
      id: 'event-1',
      title: 'Support elevation granted',
      detail: 'Actor principal-1',
      timestamp: '2026-06-26T12:25:00.000Z',
    },
  );
});
