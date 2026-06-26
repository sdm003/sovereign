import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryTenancyRepository, TenancyService } from '../tenancy';
import {
  ConversationService,
  InMemoryConversationRepository,
} from '../conversation';
import {
  HardwareKeyRegistryService,
  InMemoryHardwareKeyRepository,
  InMemoryRestrictedSessionRepository,
  RestrictedAccessGuard,
  RestrictedSessionService,
} from '../restricted';
import {
  DeviceRegistryService,
  InMemoryDeviceRepository,
  InMemorySessionRepository,
  SessionRegistryService,
} from '../device';
import { AuditEventService, InMemoryAuditEventRepository } from '../audit';
import {
  InMemoryRealtimeSubscriptionRepository,
  RealtimeDeliveryError,
  RealtimeGatewayService,
  realtimeSchemaSql,
} from './index';

async function seedRealtimeContext() {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);
  const tenant = await tenancyService.createTenant({ name: 'Realtime Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Realtime Office',
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
    userId: 'restricted-1',
    role: 'restricted_member',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'guest-1',
    role: 'guest',
    status: 'active',
  });

  const auditService = new AuditEventService(new InMemoryAuditEventRepository(), {
    now: () => new Date('2026-06-26T11:15:00.000Z'),
  });

  const sessionRegistry = new SessionRegistryService(
    new InMemorySessionRepository(),
    {
      now: () => new Date('2026-06-26T11:15:00.000Z'),
    },
  );
  const deviceRepository = new InMemoryDeviceRepository();
  const deviceService = new DeviceRegistryService(
    deviceRepository,
    tenancyRepository,
    sessionRegistry,
    auditService,
    {
      now: () => new Date('2026-06-26T11:15:00.000Z'),
    },
  );

  const restrictedDevice = await deviceService.enrollDevice({
    tenantId: tenant.id,
    userId: 'restricted-1',
    platform: 'ios',
    clientDeviceId: 'restricted-device-1',
  });
  await deviceService.approveDevice({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    deviceId: restrictedDevice.id,
  });

  const hardwareKeyService = new HardwareKeyRegistryService(
    new InMemoryHardwareKeyRepository(),
    tenancyRepository,
    deviceRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:15:00.000Z'),
    },
  );
  const restrictedKey = await hardwareKeyService.registerKey({
    tenantId: tenant.id,
    userId: 'restricted-1',
    actorUserId: 'restricted-1',
    deviceId: restrictedDevice.id,
    type: 'yubikey',
    label: 'Realtime Restricted Key',
    isBackup: false,
  });
  const restrictedSessionService = new RestrictedSessionService(
    new InMemoryRestrictedSessionRepository(),
    hardwareKeyService,
    tenancyRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:15:00.000Z'),
    },
  );
  await restrictedSessionService.activateRestrictedSession({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'restricted-1',
    hardwareKeyId: restrictedKey.id,
    deviceId: restrictedDevice.id,
  });

  const conversationService = new ConversationService(
    new InMemoryConversationRepository(),
    tenancyRepository,
    new RestrictedAccessGuard(restrictedSessionService),
  );

  const confidentialConversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'confidential',
    participantIds: ['member-1'],
  });
  const restrictedConversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'restricted',
    participantIds: ['restricted-1'],
  });

  return {
    tenant,
    office,
    auditService,
    conversationService,
    restrictedSessionService,
    confidentialConversation,
    restrictedConversation,
  };
}

test('allows authenticated participant subscriptions and delivers message and timeline events', async () => {
  const {
    tenant,
    office,
    conversationService,
    restrictedSessionService,
    confidentialConversation,
    restrictedConversation,
  } = await seedRealtimeContext();

  const gateway = new RealtimeGatewayService(
    new InMemoryRealtimeSubscriptionRepository(),
    conversationService,
    restrictedSessionService,
  );

  const memberSubscription = await gateway.subscribe({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    conversationId: confidentialConversation.id,
    connectionId: 'conn-member-1',
  });
  assert.equal(memberSubscription.allowed, true);

  const restrictedSubscription = await gateway.subscribe({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'restricted-1',
    conversationId: restrictedConversation.id,
    connectionId: 'conn-restricted-1',
  });
  assert.equal(restrictedSubscription.allowed, true);

  const messageDeliveries = await gateway.publishMessageCreated({
    tenantId: tenant.id,
    conversationId: confidentialConversation.id,
    messageId: 'message-1',
  });
  assert.deepEqual(messageDeliveries, [
    {
      connectionId: 'conn-member-1',
      event: {
        type: 'message.created',
        conversationId: confidentialConversation.id,
        messageId: 'message-1',
      },
    },
  ]);

  const timelineDeliveries = await gateway.publishTimelineEvent({
    tenantId: tenant.id,
    conversationId: restrictedConversation.id,
    eventId: 'timeline-1',
  });
  assert.deepEqual(timelineDeliveries, [
    {
      connectionId: 'conn-restricted-1',
      event: {
        type: 'timeline.event',
        conversationId: restrictedConversation.id,
        eventId: 'timeline-1',
      },
    },
  ]);
});

test('denies subscription for non-participants and restricted users without active restricted session', async () => {
  const {
    tenant,
    office,
    conversationService,
    restrictedSessionService,
    confidentialConversation,
    restrictedConversation,
  } = await seedRealtimeContext();

  const gateway = new RealtimeGatewayService(
    new InMemoryRealtimeSubscriptionRepository(),
    conversationService,
    restrictedSessionService,
  );

  await assert.rejects(
    gateway.subscribe({
      tenantId: tenant.id,
      officeId: office.id,
      userId: 'guest-1',
      conversationId: confidentialConversation.id,
      connectionId: 'conn-guest-1',
    }),
    (error: unknown) => {
      if (!(error instanceof RealtimeDeliveryError)) {
        return false;
      }

      return error.code === 'SUBSCRIPTION_DENIED';
    },
  );

  const deniedRestrictedGateway = new RealtimeGatewayService(
    new InMemoryRealtimeSubscriptionRepository(),
    conversationService,
    {
      getRestrictedSessionStatus: async () => ({
        active: false,
        reason: 'timeout',
      }),
    },
  );

  await assert.rejects(
    deniedRestrictedGateway.subscribe({
      tenantId: tenant.id,
      officeId: office.id,
      userId: 'restricted-1',
      conversationId: restrictedConversation.id,
      connectionId: 'conn-restricted-timeout',
    }),
    (error: unknown) => {
      if (!(error instanceof RealtimeDeliveryError)) {
        return false;
      }

      return error.code === 'SUBSCRIPTION_DENIED';
    },
  );
});

test('returns reconnect state sync with current allowed subscriptions', async () => {
  const {
    tenant,
    office,
    conversationService,
    restrictedSessionService,
    confidentialConversation,
  } = await seedRealtimeContext();

  const gateway = new RealtimeGatewayService(
    new InMemoryRealtimeSubscriptionRepository(),
    conversationService,
    restrictedSessionService,
  );

  await gateway.subscribe({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    conversationId: confidentialConversation.id,
    connectionId: 'conn-member-2',
  });

  const stateSync = await gateway.getStateSync({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    connectionId: 'conn-member-2',
  });

  assert.deepEqual(stateSync, {
    connectionId: 'conn-member-2',
    subscribedConversationIds: [confidentialConversation.id],
  });
});

test('exposes the baseline SQL schema for realtime subscriptions', () => {
  assert.match(realtimeSchemaSql, /create table realtime_subscription/i);
  assert.match(realtimeSchemaSql, /connection_id text not null/i);
  assert.match(realtimeSchemaSql, /conversation_id uuid not null/i);
});
