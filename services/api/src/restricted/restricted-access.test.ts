import test from 'node:test';
import assert from 'node:assert/strict';

import { AuditEventService, InMemoryAuditEventRepository } from '../audit';
import {
  DeviceRegistryService,
  InMemoryDeviceRepository,
  InMemorySessionRepository,
  SessionRegistryService,
} from '../device';
import {
  ConversationPolicyError,
  ConversationService,
  InMemoryConversationRepository,
} from '../conversation';
import { InMemoryTenancyRepository, TenancyService } from '../tenancy';
import {
  HardwareKeyPolicyError,
  HardwareKeyRegistryService,
  InMemoryHardwareKeyRepository,
  InMemoryRestrictedSessionRepository,
  restrictedAccessSchemaSql,
  RestrictedAccessGuard,
  RestrictedSessionService,
} from './index';

async function seedRestrictedContext() {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);
  const tenant = await tenancyService.createTenant({ name: 'Restricted Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Restricted Office',
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
    userId: 'restricted-1',
    role: 'restricted_member',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    role: 'member',
    status: 'active',
  });

  const auditService = new AuditEventService(new InMemoryAuditEventRepository(), {
    now: () => new Date('2026-06-26T11:10:00.000Z'),
  });
  const sessionRegistry = new SessionRegistryService(
    new InMemorySessionRepository(),
    {
      now: () => new Date('2026-06-26T11:10:00.000Z'),
    },
  );
  const deviceRepository = new InMemoryDeviceRepository();
  const deviceService = new DeviceRegistryService(
    deviceRepository,
    tenancyRepository,
    sessionRegistry,
    auditService,
    {
      now: () => new Date('2026-06-26T11:10:00.000Z'),
    },
  );

  const approvedDevice = await deviceService.enrollDevice({
    tenantId: tenant.id,
    userId: 'restricted-1',
    platform: 'ios',
    clientDeviceId: 'restricted-device-1',
  });
  await deviceService.approveDevice({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    deviceId: approvedDevice.id,
  });

  return {
    tenancyRepository,
    tenant,
    office,
    approvedDeviceId: approvedDevice.id,
    auditService,
    deviceRepository,
  };
}

test('enrolls and revokes hardware keys with audit coverage', async () => {
  const {
    tenancyRepository,
    tenant,
    approvedDeviceId,
    auditService,
    deviceRepository,
  } =
    await seedRestrictedContext();
  const service = new HardwareKeyRegistryService(
    new InMemoryHardwareKeyRepository(),
    tenancyRepository,
    deviceRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:10:00.000Z'),
    },
  );

  const primary = await service.registerKey({
    tenantId: tenant.id,
    userId: 'restricted-1',
    actorUserId: 'restricted-1',
    deviceId: approvedDeviceId,
    type: 'yubikey',
    label: 'Primary Key',
    isBackup: false,
  });
  const backup = await service.registerKey({
    tenantId: tenant.id,
    userId: 'restricted-1',
    actorUserId: 'restricted-1',
    deviceId: approvedDeviceId,
    type: 'yubikey',
    label: 'Backup Key',
    isBackup: true,
  });

  assert.equal(primary.status, 'active');
  assert.equal(backup.isBackup, true);

  const revoked = await service.revokeKey({
    tenantId: tenant.id,
    actorUserId: 'restricted-1',
    keyId: backup.id,
    reason: 'Key rotated',
  });

  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revocationReason, 'Key rotated');

  const events = await auditService.listTenantEvents(tenant.id);
  assert.deepEqual(
    events
      .filter((event) => event.type.startsWith('restricted.'))
      .map((event) => event.type)
      .sort(),
    [
      'restricted.hardware_key_registered',
      'restricted.hardware_key_registered',
      'restricted.hardware_key_revoked',
    ],
  );
});

test('activates restricted sessions only for approved devices with active keys and enforces timeout', async () => {
  const {
    tenancyRepository,
    tenant,
    office,
    approvedDeviceId,
    auditService,
    deviceRepository,
  } =
    await seedRestrictedContext();
  const keyService = new HardwareKeyRegistryService(
    new InMemoryHardwareKeyRepository(),
    tenancyRepository,
    deviceRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:15:00.000Z'),
    },
  );
  const key = await keyService.registerKey({
    tenantId: tenant.id,
    userId: 'restricted-1',
    actorUserId: 'restricted-1',
    deviceId: approvedDeviceId,
    type: 'yubikey',
    label: 'Entry Key',
    isBackup: false,
  });

  const sessionService = new RestrictedSessionService(
    new InMemoryRestrictedSessionRepository(),
    keyService,
    tenancyRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:15:00.000Z'),
    },
    15,
  );

  const session = await sessionService.activateRestrictedSession({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'restricted-1',
    hardwareKeyId: key.id,
    deviceId: approvedDeviceId,
  });

  assert.equal(session.active, true);
  assert.equal(session.reason, undefined);
  assert.equal(session.expiresAt, '2026-06-26T11:30:00.000Z');

  const activeStatus = await sessionService.getRestrictedSessionStatus({
    tenantId: tenant.id,
    userId: 'restricted-1',
    now: '2026-06-26T11:20:00.000Z',
  });
  assert.deepEqual(activeStatus, {
    active: true,
    expiresAt: '2026-06-26T11:30:00.000Z',
  });

  const timedOutStatus = await sessionService.getRestrictedSessionStatus({
    tenantId: tenant.id,
    userId: 'restricted-1',
    now: '2026-06-26T11:31:00.000Z',
  });
  assert.deepEqual(timedOutStatus, {
    active: false,
    reason: 'timeout',
  });
});

test('denies restricted access when no session exists and after key revocation', async () => {
  const {
    tenancyRepository,
    tenant,
    office,
    approvedDeviceId,
    auditService,
    deviceRepository,
  } =
    await seedRestrictedContext();
  const keyService = new HardwareKeyRegistryService(
    new InMemoryHardwareKeyRepository(),
    tenancyRepository,
    deviceRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:20:00.000Z'),
    },
  );
  const key = await keyService.registerKey({
    tenantId: tenant.id,
    userId: 'restricted-1',
    actorUserId: 'restricted-1',
    deviceId: approvedDeviceId,
    type: 'yubikey',
    label: 'Restricted Key',
    isBackup: false,
  });

  const sessionService = new RestrictedSessionService(
    new InMemoryRestrictedSessionRepository(),
    keyService,
    tenancyRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:20:00.000Z'),
    },
  );
  const guard = new RestrictedAccessGuard(sessionService);

  await assert.rejects(
    guard.assertRestrictedAccess({
      tenantId: tenant.id,
      officeId: office.id,
      userId: 'restricted-1',
      conversationTier: 'restricted',
      now: '2026-06-26T11:20:00.000Z',
    }),
    (error: unknown) => {
      if (!(error instanceof HardwareKeyPolicyError)) {
        return false;
      }

      return error.code === 'RESTRICTED_SESSION_REQUIRED';
    },
  );

  await sessionService.activateRestrictedSession({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'restricted-1',
    hardwareKeyId: key.id,
    deviceId: approvedDeviceId,
  });

  await guard.assertRestrictedAccess({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'restricted-1',
    conversationTier: 'restricted',
    now: '2026-06-26T11:22:00.000Z',
  });

  await keyService.revokeKey({
    tenantId: tenant.id,
    actorUserId: 'restricted-1',
    keyId: key.id,
    reason: 'Lost token',
  });

  await assert.rejects(
    guard.assertRestrictedAccess({
      tenantId: tenant.id,
      officeId: office.id,
      userId: 'restricted-1',
      conversationTier: 'restricted',
      now: '2026-06-26T11:23:00.000Z',
    }),
    (error: unknown) => {
      if (!(error instanceof HardwareKeyPolicyError)) {
        return false;
      }

      return error.code === 'RESTRICTED_SESSION_REVOKED_KEY';
    },
  );
});

test('filters and denies restricted conversations without an active restricted session', async () => {
  const {
    tenancyRepository,
    tenant,
    office,
    approvedDeviceId,
    auditService,
    deviceRepository,
  } = await seedRestrictedContext();
  const keyService = new HardwareKeyRegistryService(
    new InMemoryHardwareKeyRepository(),
    tenancyRepository,
    deviceRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:22:00.000Z'),
    },
  );
  const restrictedSessionService = new RestrictedSessionService(
    new InMemoryRestrictedSessionRepository(),
    keyService,
    tenancyRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:22:00.000Z'),
    },
  );
  const guard = new RestrictedAccessGuard(restrictedSessionService);
  const conversationRepository = new InMemoryConversationRepository();
  const conversationService = new ConversationService(
    conversationRepository,
    tenancyRepository,
    guard,
  );

  const conversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'restricted',
    participantIds: ['restricted-1'],
  });

  const listedWithoutSession = await conversationService.listConversations({
    tenantId: tenant.id,
    userId: 'restricted-1',
  });
  assert.equal(listedWithoutSession.length, 0);

  await assert.rejects(
    conversationService.getConversation({
      tenantId: tenant.id,
      userId: 'restricted-1',
      conversationId: conversation.id,
    }),
    (error: unknown) => {
      if (!(error instanceof HardwareKeyPolicyError)) {
        return false;
      }

      return error.code === 'RESTRICTED_SESSION_REQUIRED';
    },
  );

  const key = await keyService.registerKey({
    tenantId: tenant.id,
    userId: 'restricted-1',
    actorUserId: 'restricted-1',
    deviceId: approvedDeviceId,
    type: 'yubikey',
    label: 'Conversation Key',
    isBackup: false,
  });
  await restrictedSessionService.activateRestrictedSession({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'restricted-1',
    hardwareKeyId: key.id,
    deviceId: approvedDeviceId,
  });

  const listedWithSession = await conversationService.listConversations({
    tenantId: tenant.id,
    userId: 'restricted-1',
  });
  assert.equal(listedWithSession.length, 1);
  assert.equal(listedWithSession[0]?.id, conversation.id);
});

test('rejects restricted-session activation for non-eligible memberships or unapproved devices', async () => {
  const { tenancyRepository, tenant, office, auditService, deviceRepository } =
    await seedRestrictedContext();
  const sessionRegistry = new SessionRegistryService(new InMemorySessionRepository(), {
    now: () => new Date('2026-06-26T11:25:00.000Z'),
  });
  const deviceService = new DeviceRegistryService(
    deviceRepository,
    tenancyRepository,
    sessionRegistry,
    auditService,
    {
      now: () => new Date('2026-06-26T11:25:00.000Z'),
    },
  );
  const pendingDevice = await deviceService.enrollDevice({
    tenantId: tenant.id,
    userId: 'member-1',
    platform: 'ios',
    clientDeviceId: 'member-device-1',
  });

  const keyService = new HardwareKeyRegistryService(
    new InMemoryHardwareKeyRepository(),
    tenancyRepository,
    deviceRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:25:00.000Z'),
    },
  );

  await assert.rejects(
    keyService.registerKey({
      tenantId: tenant.id,
      userId: 'member-1',
      actorUserId: 'member-1',
      deviceId: pendingDevice.id,
      type: 'yubikey',
      label: 'Member Key',
      isBackup: false,
    }),
    (error: unknown) => {
      if (!(error instanceof HardwareKeyPolicyError)) {
        return false;
      }

      return error.code === 'RESTRICTED_MEMBERSHIP_REQUIRED';
    },
  );

  const approvedRestrictedDevice = await deviceService.enrollDevice({
    tenantId: tenant.id,
    userId: 'restricted-1',
    platform: 'ios',
    clientDeviceId: 'restricted-device-2',
  });
  const key = await keyService.registerKey({
    tenantId: tenant.id,
    userId: 'restricted-1',
    actorUserId: 'restricted-1',
    deviceId: approvedRestrictedDevice.id,
    type: 'yubikey',
    label: 'Pending Device Key',
    isBackup: false,
  });

  const restrictedSessionService = new RestrictedSessionService(
    new InMemoryRestrictedSessionRepository(),
    keyService,
    tenancyRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:25:00.000Z'),
    },
  );

  await assert.rejects(
    restrictedSessionService.activateRestrictedSession({
      tenantId: tenant.id,
      officeId: office.id,
      userId: 'restricted-1',
      hardwareKeyId: key.id,
      deviceId: approvedRestrictedDevice.id,
    }),
    (error: unknown) => {
      if (!(error instanceof HardwareKeyPolicyError)) {
        return false;
      }

      return error.code === 'APPROVED_DEVICE_REQUIRED';
    },
  );
});

test('exposes the baseline SQL schema for hardware keys and restricted sessions', () => {
  assert.match(restrictedAccessSchemaSql, /create table hardware_key/i);
  assert.match(restrictedAccessSchemaSql, /is_backup boolean not null/i);
  assert.match(restrictedAccessSchemaSql, /create table restricted_session/i);
  assert.match(restrictedAccessSchemaSql, /expires_at timestamptz not null/i);
});
