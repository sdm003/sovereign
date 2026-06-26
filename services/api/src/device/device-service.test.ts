import test from 'node:test';
import assert from 'node:assert/strict';

import { AuditEventService, InMemoryAuditEventRepository } from '../audit';
import { InMemoryTenancyRepository, TenancyService } from '../tenancy';
import {
  DeviceRegistryError,
  DeviceRegistryService,
  InMemoryDeviceRepository,
  InMemorySessionRepository,
  SessionRegistryService,
  deviceRegistrySchemaSql,
} from './index';

async function seedTenant() {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);

  const tenant = await tenancyService.createTenant({ name: 'Device Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Device Office',
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
    userId: 'suspended-1',
    role: 'member',
    status: 'suspended',
  });

  return { tenancyRepository, tenant, office };
}

test('enrolls a device in pending state and emits an audit event', async () => {
  const { tenancyRepository, tenant, office } = await seedTenant();
  const auditRepository = new InMemoryAuditEventRepository();
  const auditService = new AuditEventService(auditRepository, {
    now: () => new Date('2026-06-26T11:00:00.000Z'),
  });
  const service = new DeviceRegistryService(
    new InMemoryDeviceRepository(),
    tenancyRepository,
    new SessionRegistryService(new InMemorySessionRepository(), {
      now: () => new Date('2026-06-26T11:00:00.000Z'),
    }),
    auditService,
    {
      now: () => new Date('2026-06-26T11:00:00.000Z'),
    },
  );

  const device = await service.enrollDevice({
    tenantId: tenant.id,
    userId: 'member-1',
    platform: 'ios',
    clientDeviceId: 'ios-device-1',
    deviceName: 'Daniiar iPhone',
  });

  assert.equal(device.officeId, office.id);
  assert.equal(device.status, 'pending');
  assert.equal(device.clientDeviceId, 'ios-device-1');

  const auditEvents = await auditService.listTenantEvents(tenant.id);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0]?.type, 'device.enrolled');
  assert.deepEqual(auditEvents[0]?.metadata, {
    deviceId: device.id,
    userId: 'member-1',
    platform: 'ios',
    clientDeviceId: 'ios-device-1',
  });
});

test('approves a pending device only through an active admin actor', async () => {
  const { tenancyRepository, tenant } = await seedTenant();
  const auditService = new AuditEventService(new InMemoryAuditEventRepository());
  const service = new DeviceRegistryService(
    new InMemoryDeviceRepository(),
    tenancyRepository,
    new SessionRegistryService(new InMemorySessionRepository()),
    auditService,
  );

  const device = await service.enrollDevice({
    tenantId: tenant.id,
    userId: 'member-1',
    platform: 'ios',
    clientDeviceId: 'ios-device-2',
  });

  await assert.rejects(
    service.approveDevice({
      tenantId: tenant.id,
      actorUserId: 'member-1',
      deviceId: device.id,
    }),
    (error: unknown) => {
      if (!(error instanceof DeviceRegistryError)) {
        return false;
      }

      return error.code === 'ADMIN_ROLE_REQUIRED';
    },
  );

  const approved = await service.approveDevice({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    deviceId: device.id,
  });

  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedBy, 'principal-1');
  assert.ok(approved.approvedAt);
});

test('revokes a device, force signs out active sessions, and emits audit events', async () => {
  const { tenancyRepository, tenant, office } = await seedTenant();
  const sessionService = new SessionRegistryService(
    new InMemorySessionRepository(),
    {
      now: () => new Date('2026-06-26T11:05:00.000Z'),
    },
  );
  const auditService = new AuditEventService(new InMemoryAuditEventRepository(), {
    now: () => new Date('2026-06-26T11:05:00.000Z'),
  });
  const service = new DeviceRegistryService(
    new InMemoryDeviceRepository(),
    tenancyRepository,
    sessionService,
    auditService,
    {
      now: () => new Date('2026-06-26T11:05:00.000Z'),
    },
  );

  const device = await service.enrollDevice({
    tenantId: tenant.id,
    userId: 'member-1',
    platform: 'ios',
    clientDeviceId: 'ios-device-3',
  });
  await service.approveDevice({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    deviceId: device.id,
  });

  await sessionService.issueSession({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    deviceId: device.id,
  });
  await sessionService.issueSession({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    deviceId: device.id,
  });

  const revoked = await service.revokeDevice({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    deviceId: device.id,
    reason: 'Lost device',
  });

  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedBy, 'principal-1');
  assert.equal(revoked.revocationReason, 'Lost device');

  const sessions = await sessionService.listSessionsByDevice(device.id);
  assert.equal(sessions.length, 2);
  assert.equal(sessions.every((session) => session.status === 'revoked'), true);
  assert.equal(
    sessions.every((session) => session.revocationReason === 'device_revoked'),
    true,
  );

  const auditEvents = await auditService.listTenantEvents(tenant.id);
  assert.deepEqual(
    auditEvents.map((event) => event.type).sort(),
    ['device.approved', 'device.enrolled', 'device.revoked'],
  );
  const revokedEvent = auditEvents.find((event) => event.type === 'device.revoked');
  assert.deepEqual(revokedEvent?.metadata, {
    deviceId: device.id,
    userId: 'member-1',
    revokedSessionCount: 2,
    reason: 'Lost device',
  });
});

test('rejects enrollment for inactive memberships and invalid lifecycle transitions', async () => {
  const { tenancyRepository, tenant } = await seedTenant();
  const service = new DeviceRegistryService(
    new InMemoryDeviceRepository(),
    tenancyRepository,
    new SessionRegistryService(new InMemorySessionRepository()),
    new AuditEventService(new InMemoryAuditEventRepository()),
  );

  await assert.rejects(
    service.enrollDevice({
      tenantId: tenant.id,
      userId: 'suspended-1',
      platform: 'ios',
      clientDeviceId: 'ios-device-4',
    }),
    (error: unknown) => {
      if (!(error instanceof DeviceRegistryError)) {
        return false;
      }

      return error.code === 'INACTIVE_MEMBERSHIP_REQUIRED';
    },
  );

  const device = await service.enrollDevice({
    tenantId: tenant.id,
    userId: 'member-1',
    platform: 'web',
    clientDeviceId: 'web-device-1',
  });
  await service.approveDevice({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    deviceId: device.id,
  });

  await assert.rejects(
    service.approveDevice({
      tenantId: tenant.id,
      actorUserId: 'principal-1',
      deviceId: device.id,
    }),
    (error: unknown) => {
      if (!(error instanceof DeviceRegistryError)) {
        return false;
      }

      return error.code === 'INVALID_DEVICE_TRANSITION';
    },
  );
});

test('exposes the baseline SQL schema for devices and auth sessions', () => {
  assert.match(deviceRegistrySchemaSql, /create table device/i);
  assert.match(deviceRegistrySchemaSql, /client_device_id text not null/i);
  assert.match(deviceRegistrySchemaSql, /create table auth_session/i);
  assert.match(deviceRegistrySchemaSql, /status text not null/i);
  assert.match(deviceRegistrySchemaSql, /device_tenant_user_client_idx/i);
});
