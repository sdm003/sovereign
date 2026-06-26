import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdminAuditReviewService,
  AuditReviewAccessError,
  AuditEventService,
  InMemoryAuditEventRepository,
} from './index';
import { InMemoryTenancyRepository } from '../tenancy';

test('filters tenant audit events for active admins without leaking other tenants', async () => {
  const { auditService, reviewService } = await createFixture();

  await auditService.writeEvent({
    tenantId: 'tenant-1',
    officeId: 'office-1',
    actorId: 'admin-1',
    type: 'auth.invitation_issued',
    metadata: {
      invitationId: 'invite-1',
    },
  });
  await auditService.writeEvent({
    tenantId: 'tenant-1',
    officeId: 'office-1',
    actorId: 'member-1',
    type: 'tier.conversation_tier_changed',
    metadata: {
      conversationId: 'conversation-1',
      fromTier: 'personal',
      toTier: 'confidential',
    },
  });
  await auditService.writeEvent({
    tenantId: 'tenant-1',
    officeId: 'office-1',
    actorId: 'member-1',
    type: 'tier.conversation_tier_changed',
    metadata: {
      conversationId: 'conversation-2',
      fromTier: 'confidential',
      toTier: 'restricted',
    },
  });
  await auditService.writeEvent({
    tenantId: 'tenant-2',
    officeId: 'office-2',
    actorId: 'other-admin',
    type: 'auth.invitation_issued',
    metadata: {
      invitationId: 'invite-other',
      conversationId: 'conversation-1',
    },
  });

  const filtered = await reviewService.queryEvents({
    tenantId: 'tenant-1',
    actorUserId: 'admin-1',
    filters: {
      actorId: 'member-1',
      conversationId: 'conversation-1',
      type: 'tier.conversation_tier_changed',
    },
  });

  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0]?.tenantId, 'tenant-1');
  assert.equal(filtered.items[0]?.actorId, 'member-1');
  assert.equal(filtered.items[0]?.conversationId, 'conversation-1');
  assert.equal(filtered.items[0]?.type, 'tier.conversation_tier_changed');
  assert.deepEqual(Object.keys(filtered.items[0] ?? {}), [
    'id',
    'tenantId',
    'officeId',
    'type',
    'occurredAt',
    'actorId',
    'conversationId',
  ]);
});

test('supports date range filtering and detail lookup for admin review', async () => {
  const { auditService, reviewService } = await createFixture();

  await auditService.writeEvent({
    tenantId: 'tenant-1',
    officeId: 'office-1',
    actorId: 'admin-1',
    type: 'auth.invitation_issued',
    metadata: {
      invitationId: 'invite-1',
    },
  });
  await auditService.writeEvent({
    tenantId: 'tenant-1',
    officeId: 'office-1',
    actorId: 'admin-1',
    type: 'support.elevation_requested',
    metadata: {
      supportActionId: 'support-1',
    },
  });

  const filtered = await reviewService.queryEvents({
    tenantId: 'tenant-1',
    actorUserId: 'admin-1',
    filters: {
      from: '2026-06-26T11:00:00.000Z',
      to: '2026-06-26T11:05:00.000Z',
    },
  });
  const detail = await reviewService.getEventDetail({
    tenantId: 'tenant-1',
    actorUserId: 'admin-1',
    eventId: filtered.items[0]?.id ?? '',
  });

  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0]?.type, 'support.elevation_requested');
  assert.equal(detail.metadata.supportActionId, 'support-1');
});

test('requires active principal or office admin membership for audit review', async () => {
  const { reviewService } = await createFixture();

  await assert.rejects(
    reviewService.queryEvents({
      tenantId: 'tenant-1',
      actorUserId: 'member-1',
      filters: {},
    }),
    (error: unknown) =>
      error instanceof AuditReviewAccessError &&
      error.code === 'ADMIN_ROLE_REQUIRED',
  );

  await assert.rejects(
    reviewService.getEventDetail({
      tenantId: 'tenant-1',
      actorUserId: 'suspended-admin',
      eventId: 'event-1',
    }),
    (error: unknown) =>
      error instanceof AuditReviewAccessError &&
      error.code === 'ACTIVE_ADMIN_REQUIRED',
  );
});

async function createFixture() {
  const tenancyRepository = new InMemoryTenancyRepository();
  await tenancyRepository.createTenant({
    id: 'tenant-1',
    name: 'Tenant 1',
    createdAt: '2026-06-26T10:00:00.000Z',
  });
  await tenancyRepository.createOffice({
    id: 'office-1',
    tenantId: 'tenant-1',
    name: 'Office 1',
    createdAt: '2026-06-26T10:00:00.000Z',
  });
  await tenancyRepository.createTenant({
    id: 'tenant-2',
    name: 'Tenant 2',
    createdAt: '2026-06-26T10:00:00.000Z',
  });
  await tenancyRepository.createOffice({
    id: 'office-2',
    tenantId: 'tenant-2',
    name: 'Office 2',
    createdAt: '2026-06-26T10:00:00.000Z',
  });
  await tenancyRepository.createMembership({
    id: 'membership-admin',
    tenantId: 'tenant-1',
    officeId: 'office-1',
    userId: 'admin-1',
    role: 'office_admin',
    status: 'active',
    onboardingStatus: 'active',
    kycStatus: 'approved',
    createdAt: '2026-06-26T10:00:00.000Z',
  });
  await tenancyRepository.createMembership({
    id: 'membership-member',
    tenantId: 'tenant-1',
    officeId: 'office-1',
    userId: 'member-1',
    role: 'member',
    status: 'active',
    onboardingStatus: 'active',
    kycStatus: 'approved',
    createdAt: '2026-06-26T10:00:00.000Z',
  });
  await tenancyRepository.createMembership({
    id: 'membership-suspended',
    tenantId: 'tenant-1',
    officeId: 'office-1',
    userId: 'suspended-admin',
    role: 'principal',
    status: 'suspended',
    onboardingStatus: 'active',
    kycStatus: 'approved',
    createdAt: '2026-06-26T10:00:00.000Z',
  });

  const auditRepository = new InMemoryAuditEventRepository();
  const timestamps = [
    '2026-06-26T10:50:00.000Z',
    '2026-06-26T11:02:00.000Z',
    '2026-06-26T11:10:00.000Z',
    '2026-06-26T11:20:00.000Z',
  ];
  const auditService = new AuditEventService(auditRepository, {
    now: () => new Date(timestamps.shift() ?? '2026-06-26T11:30:00.000Z'),
  });
  const reviewService = new AdminAuditReviewService(
    auditRepository,
    tenancyRepository,
  );

  return {
    auditService,
    reviewService,
  };
}
