import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AuditEventService,
  InMemoryAuditEventRepository,
} from '../audit';
import {
  ConversationPolicyError,
  ConversationService,
  InMemoryConversationRepository,
} from '../conversation';
import {
  DeviceRegistryService,
  InMemoryDeviceRepository,
  InMemorySessionRepository,
  SessionRegistryService,
} from '../device';
import {
  InMemoryRealtimeSubscriptionRepository,
  RealtimeDeliveryError,
  RealtimeGatewayService,
} from '../realtime';
import { InMemoryTenancyRepository, TenancyService } from '../tenancy';
import {
  GuestAccessService,
  GuestGovernanceError,
  InMemoryGuestAccessRepository,
  guestAccessSchemaSql,
} from './index';

async function createFixture() {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);
  const tenant = await tenancyService.createTenant({ name: 'Guest Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Guest Office',
  });

  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'principal-1',
    role: 'principal',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    role: 'member',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'guest-1',
    role: 'guest',
    status: 'active',
  });

  const auditRepository = new InMemoryAuditEventRepository();
  const auditTimestamps = [
    '2026-06-26T11:35:00.000Z',
    '2026-06-26T11:36:00.000Z',
    '2026-06-26T11:37:00.000Z',
  ];
  const auditService = new AuditEventService(auditRepository, {
    now: () =>
      new Date(auditTimestamps.shift() ?? '2026-06-26T11:38:00.000Z'),
  });
  const conversationRepository = new InMemoryConversationRepository();
  const guestRepository = new InMemoryGuestAccessRepository();
  const guestService = new GuestAccessService(
    guestRepository,
    tenancyRepository,
    conversationRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:35:00.000Z'),
    },
  );
  const conversationService = new ConversationService(
    conversationRepository,
    tenancyRepository,
    undefined,
    guestService,
  );

  return {
    auditService,
    conversationService,
    guestService,
    office,
    tenant,
  };
}

test('creates office-scoped guest identities and emits audit records', async () => {
  const { auditService, guestService, office, tenant } = await createFixture();

  const guest = await guestService.createGuestIdentity({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
    displayName: 'Outside Counsel',
  });

  assert.equal(guest.tenantId, tenant.id);
  assert.equal(guest.officeId, office.id);
  assert.equal(guest.userId, 'guest-1');
  assert.equal(guest.displayName, 'Outside Counsel');
  assert.equal(guest.status, 'active');

  const auditEvents = await auditService.listTenantEvents(tenant.id);
  assert.deepEqual(auditEvents.map((event) => event.type), [
    'guest.identity_created',
  ]);
  assert.equal(auditEvents[0]?.metadata.guestUserId, 'guest-1');
});

test('grants and revokes explicit conversation scopes with audit coverage', async () => {
  const {
    auditService,
    conversationService,
    guestService,
    office,
    tenant,
  } = await createFixture();
  await guestService.createGuestIdentity({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
  });
  const conversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'confidential',
    participantIds: ['member-1', 'guest-1'],
  });

  const grants = await guestService.grantConversationScopes({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
    conversationIds: [conversation.id],
  });

  assert.equal(grants.length, 1);
  assert.equal(grants[0]?.conversationId, conversation.id);
  assert.equal(
    await guestService.canAccessConversation({
      tenantId: tenant.id,
      guestUserId: 'guest-1',
      conversationId: conversation.id,
    }),
    true,
  );

  await guestService.revokeConversationScope({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
    conversationId: conversation.id,
  });

  assert.equal(
    await guestService.canAccessConversation({
      tenantId: tenant.id,
      guestUserId: 'guest-1',
      conversationId: conversation.id,
    }),
    false,
  );
  assert.deepEqual(
    (await auditService.listTenantEvents(tenant.id)).map((event) => event.type),
    [
      'guest.scope_revoked',
      'guest.scope_granted',
      'guest.identity_created',
    ],
  );
});

test('enforces no-discovery filtering for guest list and detail reads', async () => {
  const { conversationService, guestService, office, tenant } =
    await createFixture();
  await guestService.createGuestIdentity({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
  });
  const grantedConversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'confidential',
    participantIds: ['member-1', 'guest-1'],
  });
  const hiddenConversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'confidential',
    participantIds: ['member-1', 'guest-1'],
  });
  await guestService.grantConversationScopes({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
    conversationIds: [grantedConversation.id],
  });

  const visible = await conversationService.listConversations({
    tenantId: tenant.id,
    userId: 'guest-1',
  });
  const detail = await conversationService.getConversation({
    tenantId: tenant.id,
    userId: 'guest-1',
    conversationId: grantedConversation.id,
  });

  assert.deepEqual(visible.map((conversation) => conversation.id), [
    grantedConversation.id,
  ]);
  assert.deepEqual(detail.participantIds, ['guest-1']);
  await assert.rejects(
    conversationService.getConversation({
      tenantId: tenant.id,
      userId: 'guest-1',
      conversationId: hiddenConversation.id,
    }),
    (error: unknown) =>
      error instanceof ConversationPolicyError &&
      error.code === 'CONVERSATION_ACCESS_DENIED',
  );
});

test('restricts guest directory to minimal safe identity info', async () => {
  const { guestService, office, tenant } = await createFixture();
  await guestService.createGuestIdentity({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
    displayName: 'Outside Counsel',
  });

  const directory = await guestService.listGuestDirectory({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
  });

  assert.deepEqual(directory, [
    {
      guestId: directory[0]?.guestId,
      userId: 'guest-1',
      displayName: 'Outside Counsel',
      status: 'active',
    },
  ]);
  assert.deepEqual(Object.keys(directory[0] ?? {}), [
    'guestId',
    'userId',
    'displayName',
    'status',
  ]);
});

test('requires admins for guest governance and exposes SQL schema', async () => {
  const { guestService, office, tenant } = await createFixture();

  await assert.rejects(
    guestService.createGuestIdentity({
      tenantId: tenant.id,
      officeId: office.id,
      actorUserId: 'member-1',
      guestUserId: 'guest-1',
    }),
    (error: unknown) =>
      error instanceof GuestGovernanceError &&
      error.code === 'ADMIN_ROLE_REQUIRED',
  );

  assert.match(guestAccessSchemaSql, /create table guest_identity/i);
  assert.match(guestAccessSchemaSql, /create table guest_scope/i);
  assert.match(guestAccessSchemaSql, /guest_scope_active_unique_idx/i);
});

test('kill switch immediately revokes guest access, sessions, realtime subscriptions, and emits audit', async () => {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);
  const tenant = await tenancyService.createTenant({ name: 'Kill Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Kill Office',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'principal-1',
    role: 'principal',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'guest-1',
    role: 'guest',
    status: 'active',
  });

  const auditTimestamps = [
    '2026-06-26T11:45:00.000Z',
    '2026-06-26T11:46:00.000Z',
    '2026-06-26T11:47:00.000Z',
    '2026-06-26T11:48:00.000Z',
    '2026-06-26T11:49:00.000Z',
  ];
  const auditService = new AuditEventService(new InMemoryAuditEventRepository(), {
    now: () =>
      new Date(auditTimestamps.shift() ?? '2026-06-26T11:50:00.000Z'),
  });
  const conversationRepository = new InMemoryConversationRepository();
  const sessionRepository = new InMemorySessionRepository();
  const sessionRegistry = new SessionRegistryService(sessionRepository, {
    now: () => new Date('2026-06-26T11:48:00.000Z'),
  });
  const realtimeRepository = new InMemoryRealtimeSubscriptionRepository();
  const deviceService = new DeviceRegistryService(
    new InMemoryDeviceRepository(),
    tenancyRepository,
    sessionRegistry,
    auditService,
    {
      now: () => new Date('2026-06-26T11:45:00.000Z'),
    },
  );
  const guestRepository = new InMemoryGuestAccessRepository();
  let realtimeGateway: RealtimeGatewayService;
  const guestService = new GuestAccessService(
    guestRepository,
    tenancyRepository,
    conversationRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:48:00.000Z'),
    },
    sessionRegistry,
    {
      invalidateUserSubscriptions: (input) =>
        realtimeGateway.invalidateUserSubscriptions(input),
    },
  );
  const conversationService = new ConversationService(
    conversationRepository,
    tenancyRepository,
    undefined,
    guestService,
  );
  realtimeGateway = new RealtimeGatewayService(
    realtimeRepository,
    conversationService,
    {
      getRestrictedSessionStatus: async () => ({ active: true }),
    },
  );

  const guest = await guestService.createGuestIdentity({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
  });
  const conversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'confidential',
    participantIds: ['guest-1'],
  });
  await guestService.grantConversationScopes({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
    conversationIds: [conversation.id],
  });
  const device = await deviceService.enrollDevice({
    tenantId: tenant.id,
    userId: 'guest-1',
    platform: 'ios',
    clientDeviceId: 'guest-device-1',
  });
  const session = await sessionRegistry.issueSession({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'guest-1',
    deviceId: device.id,
  });
  await realtimeGateway.subscribe({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'guest-1',
    conversationId: conversation.id,
    connectionId: 'conn-guest-1',
  });

  const result = await guestService.killGuestAccess({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    guestUserId: 'guest-1',
    reason: 'external counsel engagement ended',
  });

  assert.equal(result.guestId, guest.id);
  assert.equal(result.revokedScopeCount, 1);
  assert.equal(result.revokedSessionCount, 1);
  assert.equal(result.invalidatedRealtimeSubscriptionCount, 1);
  assert.equal(
    await guestService.canAccessConversation({
      tenantId: tenant.id,
      guestUserId: 'guest-1',
      conversationId: conversation.id,
    }),
    false,
  );
  assert.deepEqual(await sessionRegistry.listSessionsByUser(tenant.id, 'guest-1'), [
    {
      ...session,
      status: 'revoked',
      revokedAt: '2026-06-26T11:48:00.000Z',
      revocationReason: 'guest_kill_switch',
    },
  ]);
  assert.deepEqual(
    await realtimeGateway.publishMessageCreated({
      tenantId: tenant.id,
      conversationId: conversation.id,
      messageId: 'message-after-kill',
    }),
    [],
  );
  await assert.rejects(
    realtimeGateway.subscribe({
      tenantId: tenant.id,
      officeId: office.id,
      userId: 'guest-1',
      conversationId: conversation.id,
      connectionId: 'conn-guest-after-kill',
    }),
    (error: unknown) =>
      error instanceof RealtimeDeliveryError &&
      error.code === 'SUBSCRIPTION_DENIED',
  );
  assert.deepEqual(
    (await auditService.listTenantEvents(tenant.id)).map((event) => event.type),
    [
      'guest.kill_switch_activated',
      'device.enrolled',
      'guest.scope_granted',
      'guest.identity_created',
    ],
  );
});
