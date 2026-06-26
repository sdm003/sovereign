import test from 'node:test';
import assert from 'node:assert/strict';

import { AuditEventService, InMemoryAuditEventRepository } from '../audit';
import {
  ConversationService,
  InMemoryConversationRepository,
} from '../conversation';
import { InMemoryTenancyRepository, TenancyService } from '../tenancy';
import {
  DissolutionWorkflowError,
  DissolutionWorkflowService,
  InMemoryDissolutionRepository,
  dissolutionSchemaSql,
} from './index';

async function seedDissolutionContext() {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);
  const tenant = await tenancyService.createTenant({ name: 'Dissolution Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Dissolution Office',
  });

  for (const [userId, role] of [
    ['principal-1', 'principal'],
    ['member-1', 'member'],
    ['member-2', 'member'],
  ] as const) {
    await tenancyService.createMembership({
      tenantId: tenant.id,
      officeId: office.id,
      userId,
      role,
      status: 'active',
    });
  }

  const conversationRepository = new InMemoryConversationRepository();
  const conversationService = new ConversationService(
    conversationRepository,
    tenancyRepository,
  );
  const auditService = new AuditEventService(new InMemoryAuditEventRepository(), {
    now: () => new Date('2026-06-26T12:05:00.000Z'),
  });
  const timelineEvents: Array<{ tenantId: string; conversationId: string; eventId: string }> = [];
  const service = new DissolutionWorkflowService(
    new InMemoryDissolutionRepository(),
    conversationService,
    conversationRepository,
    auditService,
    {
      publishTimelineEvent: async (event) => {
        timelineEvents.push(event);
        return [];
      },
    },
    {
      now: () => new Date('2026-06-26T12:05:00.000Z'),
    },
  );
  const conversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'confidential',
    participantIds: ['member-1'],
  });

  return {
    auditService,
    conversation,
    conversationService,
    service,
    tenant,
    timelineEvents,
  };
}

test('requests and confirms bilateral dissolution with audit and timeline hooks', async () => {
  const { auditService, conversation, service, tenant, timelineEvents } =
    await seedDissolutionContext();

  const requested = await service.requestDissolution({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    conversationId: conversation.id,
  });

  assert.equal(requested.status, 'pending_confirmation');
  assert.equal(requested.requestedBy, 'principal-1');
  assert.equal(requested.confirmedBy, undefined);
  assert.equal(requested.rejectedBy, undefined);

  const confirmed = await service.confirmDissolution({
    tenantId: tenant.id,
    actorUserId: 'member-1',
    conversationId: conversation.id,
  });

  assert.equal(confirmed.id, requested.id);
  assert.equal(confirmed.status, 'completed');
  assert.equal(confirmed.confirmedBy, 'member-1');
  assert.equal(confirmed.resolvedAt, '2026-06-26T12:05:00.000Z');
  assert.deepEqual(
    timelineEvents.map((event) => event.eventId),
    [
      `dissolution.${requested.id}.requested`,
      `dissolution.${requested.id}.completed`,
    ],
  );
  assert.deepEqual(
    (await auditService.listTenantEvents(tenant.id)).map((event) => event.type),
    ['dissolution.requested', 'dissolution.resolved'],
  );
});

test('rejects dissolution without destructive state changes', async () => {
  const { auditService, conversation, service, tenant } =
    await seedDissolutionContext();

  const requested = await service.requestDissolution({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    conversationId: conversation.id,
  });
  const rejected = await service.rejectDissolution({
    tenantId: tenant.id,
    actorUserId: 'member-1',
    conversationId: conversation.id,
    reason: 'not ready to close',
  });

  assert.equal(rejected.id, requested.id);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.rejectedBy, 'member-1');
  assert.equal(rejected.rejectionReason, 'not ready to close');
  assert.deepEqual(
    (await auditService.listTenantEvents(tenant.id)).map((event) => event.type),
    ['dissolution.requested', 'dissolution.resolved'],
  );
});

test('blocks unilateral and invalid dissolution transitions', async () => {
  const { conversation, conversationService, service, tenant } =
    await seedDissolutionContext();

  await service.requestDissolution({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    conversationId: conversation.id,
  });

  await assert.rejects(
    service.confirmDissolution({
      tenantId: tenant.id,
      actorUserId: 'principal-1',
      conversationId: conversation.id,
    }),
    (error: unknown) =>
      error instanceof DissolutionWorkflowError &&
      error.code === 'UNILATERAL_CONFIRMATION_DENIED',
  );
  await assert.rejects(
    service.requestDissolution({
      tenantId: tenant.id,
      actorUserId: 'member-2',
      conversationId: conversation.id,
    }),
    (error: unknown) =>
      error instanceof DissolutionWorkflowError &&
      error.code === 'CONVERSATION_ACCESS_DENIED',
  );
  await assert.rejects(
    service.requestDissolution({
      tenantId: tenant.id,
      actorUserId: 'member-1',
      conversationId: conversation.id,
    }),
    (error: unknown) =>
      error instanceof DissolutionWorkflowError &&
      error.code === 'PENDING_REQUEST_EXISTS',
  );

  const personal = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'personal',
    participantIds: [],
  });
  await assert.rejects(
    service.requestDissolution({
      tenantId: tenant.id,
      actorUserId: 'principal-1',
      conversationId: personal.id,
    }),
    (error: unknown) =>
      error instanceof DissolutionWorkflowError &&
      error.code === 'CONVERSATION_NOT_ELIGIBLE',
  );
});

test('exposes dissolution SQL storage for governed history', () => {
  assert.match(dissolutionSchemaSql, /create table dissolution_request/i);
  assert.match(dissolutionSchemaSql, /status text not null/i);
  assert.match(dissolutionSchemaSql, /requested_by uuid not null/i);
  assert.match(dissolutionSchemaSql, /confirmed_by uuid/i);
  assert.match(dissolutionSchemaSql, /rejected_by uuid/i);
});
