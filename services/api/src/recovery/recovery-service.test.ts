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
  HardwareKeyRegistryService,
  InMemoryHardwareKeyRepository,
  InMemoryRestrictedSessionRepository,
  RestrictedSessionService,
} from '../restricted';
import { InMemoryTenancyRepository, TenancyService } from '../tenancy';
import {
  InMemoryRecoveryRepository,
  RecoveryPolicyError,
  RecoveryService,
  recoveryWorkflowSchemaSql,
} from './index';

async function seedRecoveryContext() {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);
  const tenant = await tenancyService.createTenant({ name: 'Recovery Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Recovery Office',
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

  const auditService = new AuditEventService(new InMemoryAuditEventRepository(), {
    now: () => new Date('2026-06-26T11:35:00.000Z'),
  });
  const sessionRegistry = new SessionRegistryService(
    new InMemorySessionRepository(),
    {
      now: () => new Date('2026-06-26T11:35:00.000Z'),
    },
  );
  const deviceRepository = new InMemoryDeviceRepository();
  const deviceService = new DeviceRegistryService(
    deviceRepository,
    tenancyRepository,
    sessionRegistry,
    auditService,
    {
      now: () => new Date('2026-06-26T11:35:00.000Z'),
    },
  );

  const device = await deviceService.enrollDevice({
    tenantId: tenant.id,
    userId: 'restricted-1',
    platform: 'ios',
    clientDeviceId: 'recovery-device-1',
  });
  await deviceService.approveDevice({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    deviceId: device.id,
  });

  const keyRepository = new InMemoryHardwareKeyRepository();
  const keyService = new HardwareKeyRegistryService(
    keyRepository,
    tenancyRepository,
    deviceRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:35:00.000Z'),
    },
  );
  const key = await keyService.registerKey({
    tenantId: tenant.id,
    userId: 'restricted-1',
    actorUserId: 'restricted-1',
    deviceId: device.id,
    type: 'yubikey',
    label: 'Primary Recovery Key',
    isBackup: false,
  });

  const restrictedSessionRepository = new InMemoryRestrictedSessionRepository();
  const restrictedSessionService = new RestrictedSessionService(
    restrictedSessionRepository,
    keyService,
    tenancyRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T11:35:00.000Z'),
    },
  );
  await restrictedSessionService.activateRestrictedSession({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'restricted-1',
    hardwareKeyId: key.id,
    deviceId: device.id,
  });
  await sessionRegistry.issueSession({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'restricted-1',
    deviceId: device.id,
  });

  return {
    tenancyRepository,
    tenant,
    office,
    auditService,
    sessionRegistry,
    deviceService,
    keyService,
    restrictedSessionService,
    restrictedSessionRepository,
    deviceId: device.id,
    hardwareKeyId: key.id,
  };
}

test('runs the governed recovery workflow through approval, SIM verification, and completion', async () => {
  const {
    tenancyRepository,
    tenant,
    office,
    auditService,
    sessionRegistry,
    deviceService,
    keyService,
    restrictedSessionService,
    deviceId,
    hardwareKeyId,
  } = await seedRecoveryContext();

  const service = new RecoveryService(
    new InMemoryRecoveryRepository(),
    tenancyRepository,
    deviceService,
    sessionRegistry,
    keyService,
    restrictedSessionService,
    auditService,
    {
      now: () => new Date('2026-06-26T11:40:00.000Z'),
    },
  );

  const requested = await service.requestRecovery({
    tenantId: tenant.id,
    userId: 'restricted-1',
    officeId: office.id,
    reason: 'Lost phone and key',
    recoveryChannel: '+77010000000',
  });
  assert.equal(requested.status, 'requested');

  const approved = await service.approveRecovery({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    recoveryRequestId: requested.id,
  });
  assert.equal(approved.status, 'verification_pending');
  assert.equal(approved.approvedBy, 'principal-1');

  const verified = await service.verifyRecoveryChannel({
    tenantId: tenant.id,
    recoveryRequestId: requested.id,
    verifiedBy: 'principal-1',
    providedChannel: '+77010000000',
  });
  assert.equal(verified.recoveryChannelVerifiedAt, '2026-06-26T11:40:00.000Z');

  const completed = await service.completeRecovery({
    tenantId: tenant.id,
    officeId: office.id,
    recoveryRequestId: requested.id,
    actorUserId: 'principal-1',
    replacementDevice: {
      platform: 'ios',
      clientDeviceId: 'recovery-device-2',
      deviceName: 'Recovered iPhone',
    },
    replacementHardwareKey: {
      type: 'yubikey',
      label: 'Replacement Recovery Key',
      isBackup: false,
    },
  });

  assert.equal(completed.status, 'completed');
  assert.ok(completed.completedAt);
  assert.ok(completed.reissuedDeviceId);
  assert.ok(completed.reissuedHardwareKeyId);
  assert.notEqual(completed.reissuedDeviceId, deviceId);
  assert.notEqual(completed.reissuedHardwareKeyId, hardwareKeyId);

  const oldSessions = await sessionRegistry.listSessionsByDevice(deviceId);
  assert.equal(oldSessions.every((session) => session.status === 'revoked'), true);
  assert.equal(
    oldSessions.every((session) => session.revocationReason === 'device_revoked'),
    true,
  );

  const replacementDevice = await deviceService.getDevice(completed.reissuedDeviceId!);
  assert.equal(replacementDevice?.status, 'approved');
  const replacementKey = await keyService.getKey(completed.reissuedHardwareKeyId!);
  assert.equal(replacementKey?.status, 'active');

  const restrictedStatus = await restrictedSessionService.getRestrictedSessionStatus({
    tenantId: tenant.id,
    userId: 'restricted-1',
    now: '2026-06-26T11:41:00.000Z',
  });
  assert.deepEqual(restrictedStatus, {
    active: false,
    reason: 'revoked_key',
  });

  const auditEvents = await auditService.listTenantEvents(tenant.id);
  assert.deepEqual(
    auditEvents
      .filter((event) => event.type.startsWith('recovery.'))
      .map((event) => event.type)
      .sort(),
    [
      'recovery.admin_approved',
      'recovery.completed',
      'recovery.requested',
      'recovery.sim_verified',
    ],
  );
});

test('rejects completion before admin approval and SIM verification', async () => {
  const {
    tenancyRepository,
    tenant,
    office,
    auditService,
    sessionRegistry,
    deviceService,
    keyService,
    restrictedSessionService,
  } = await seedRecoveryContext();

  const service = new RecoveryService(
    new InMemoryRecoveryRepository(),
    tenancyRepository,
    deviceService,
    sessionRegistry,
    keyService,
    restrictedSessionService,
    auditService,
    {
      now: () => new Date('2026-06-26T11:45:00.000Z'),
    },
  );

  const request = await service.requestRecovery({
    tenantId: tenant.id,
    userId: 'restricted-1',
    officeId: office.id,
    reason: 'Lost everything',
    recoveryChannel: '+77010000000',
  });

  await assert.rejects(
    service.completeRecovery({
      tenantId: tenant.id,
      officeId: office.id,
      recoveryRequestId: request.id,
      actorUserId: 'principal-1',
      replacementDevice: {
        platform: 'ios',
        clientDeviceId: 'recovery-device-3',
      },
      replacementHardwareKey: {
        type: 'yubikey',
        label: 'Replacement',
        isBackup: false,
      },
    }),
    (error: unknown) => {
      if (!(error instanceof RecoveryPolicyError)) {
        return false;
      }

      return error.code === 'RECOVERY_VERIFICATION_REQUIRED';
    },
  );
});

test('requires admin approval and exact recovery-channel verification', async () => {
  const {
    tenancyRepository,
    tenant,
    office,
    auditService,
    sessionRegistry,
    deviceService,
    keyService,
    restrictedSessionService,
  } = await seedRecoveryContext();

  const service = new RecoveryService(
    new InMemoryRecoveryRepository(),
    tenancyRepository,
    deviceService,
    sessionRegistry,
    keyService,
    restrictedSessionService,
    auditService,
    {
      now: () => new Date('2026-06-26T11:50:00.000Z'),
    },
  );

  const request = await service.requestRecovery({
    tenantId: tenant.id,
    userId: 'restricted-1',
    officeId: office.id,
    reason: 'Key destroyed',
    recoveryChannel: '+77010000000',
  });

  await assert.rejects(
    service.approveRecovery({
      tenantId: tenant.id,
      actorUserId: 'restricted-1',
      recoveryRequestId: request.id,
    }),
    (error: unknown) => {
      if (!(error instanceof RecoveryPolicyError)) {
        return false;
      }

      return error.code === 'ADMIN_ROLE_REQUIRED';
    },
  );

  await service.approveRecovery({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    recoveryRequestId: request.id,
  });

  await assert.rejects(
    service.verifyRecoveryChannel({
      tenantId: tenant.id,
      recoveryRequestId: request.id,
      verifiedBy: 'principal-1',
      providedChannel: '+77019999999',
    }),
    (error: unknown) => {
      if (!(error instanceof RecoveryPolicyError)) {
        return false;
      }

      return error.code === 'RECOVERY_CHANNEL_MISMATCH';
    },
  );
});

test('exposes the baseline SQL schema for recovery requests', () => {
  assert.match(recoveryWorkflowSchemaSql, /create table recovery_request/i);
  assert.match(recoveryWorkflowSchemaSql, /recovery_channel text not null/i);
  assert.match(recoveryWorkflowSchemaSql, /replacement_device_id uuid/i);
  assert.match(recoveryWorkflowSchemaSql, /replacement_hardware_key_id uuid/i);
});
