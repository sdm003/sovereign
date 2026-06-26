import test from 'node:test';
import assert from 'node:assert/strict';

import { AuditEventService, InMemoryAuditEventRepository } from '../audit';
import { InMemoryTenancyRepository, TenancyService } from '../tenancy';
import {
  InMemorySupportElevationRepository,
  SupportElevationService,
  SupportElevationPolicyError,
  supportElevationSchemaSql,
} from './index';

async function seedSupportFixture() {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);
  const tenant = await tenancyService.createTenant({ name: 'Support Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Support Office',
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
    userId: 'office-admin-1',
    role: 'office_admin',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    role: 'member',
    status: 'active',
  });

  const auditTimestamps = [
    '2026-06-26T12:25:00.000Z',
    '2026-06-26T12:26:00.000Z',
  ];
  const auditService = new AuditEventService(new InMemoryAuditEventRepository(), {
    now: () =>
      new Date(auditTimestamps.shift() ?? '2026-06-26T12:27:00.000Z'),
  });
  const service = new SupportElevationService(
    new InMemorySupportElevationRepository(),
    tenancyRepository,
    auditService,
    {
      now: () => new Date('2026-06-26T12:25:00.000Z'),
    },
  );

  return { auditService, office, service, tenant };
}

test('keeps support content access denied unless an active elevation exists', async () => {
  const { office, service, tenant } = await seedSupportFixture();

  assert.deepEqual(
    await service.getSupportAccessStatus({
      tenantId: tenant.id,
      officeId: office.id,
      supportUserId: 'support-1',
    }),
    {
      tenantId: tenant.id,
      officeId: office.id,
      supportUserId: 'support-1',
      status: 'not_elevated',
      contentAccess: 'denied',
    },
  );
  assert.equal(
    await service.canAccessContent({
      tenantId: tenant.id,
      officeId: office.id,
      supportUserId: 'support-1',
    }),
    false,
  );
});

test('grants and revokes explicit auditable support elevation', async () => {
  const { auditService, office, service, tenant } = await seedSupportFixture();

  const active = await service.grantElevation({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    supportUserId: 'support-1',
    reason: 'Investigate signed storage outage',
    expiresAt: '2026-06-26T13:25:00.000Z',
  });

  assert.equal(active.status, 'active');
  assert.equal(active.reason, 'Investigate signed storage outage');
  assert.equal(active.grantedBy, 'principal-1');
  assert.equal(active.contentAccess, 'elevated');
  assert.equal(
    await service.canAccessContent({
      tenantId: tenant.id,
      officeId: office.id,
      supportUserId: 'support-1',
    }),
    true,
  );

  const revoked = await service.revokeElevation({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'office-admin-1',
    supportUserId: 'support-1',
    reason: 'Support session finished',
  });

  assert.equal(revoked.id, active.id);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedBy, 'office-admin-1');
  assert.equal(revoked.revocationReason, 'Support session finished');
  assert.equal(
    await service.canAccessContent({
      tenantId: tenant.id,
      officeId: office.id,
      supportUserId: 'support-1',
    }),
    false,
  );
  assert.deepEqual(
    (await auditService.listTenantEvents(tenant.id)).map((event) => event.type),
    ['support.elevation_revoked', 'support.elevation_granted'],
  );
});

test('supports explicit pending request approval before elevated access', async () => {
  const { auditService, office, service, tenant } = await seedSupportFixture();

  const pending = await service.requestElevation({
    tenantId: tenant.id,
    officeId: office.id,
    requestedBy: 'support-1',
    supportUserId: 'support-1',
    reason: 'Investigate message delivery incident',
    expiresAt: '2026-06-26T13:25:00.000Z',
  });

  assert.equal(pending.status, 'pending');
  assert.equal(
    await service.canAccessContent({
      tenantId: tenant.id,
      officeId: office.id,
      supportUserId: 'support-1',
    }),
    false,
  );

  const active = await service.approveElevation({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    supportElevationId: pending.id,
    expiresAt: '2026-06-26T13:25:00.000Z',
  });

  assert.equal(active.status, 'active');
  assert.equal(active.contentAccess, 'elevated');
  assert.equal(
    await service.canAccessContent({
      tenantId: tenant.id,
      officeId: office.id,
      supportUserId: 'support-1',
    }),
    true,
  );
  assert.deepEqual(
    (await auditService.listTenantEvents(tenant.id)).map((event) => event.type),
    ['support.elevation_granted', 'support.elevation_requested'],
  );
});

test('rejects non-admin elevation and duplicate active elevation', async () => {
  const { office, service, tenant } = await seedSupportFixture();

  await assert.rejects(
    service.grantElevation({
      tenantId: tenant.id,
      officeId: office.id,
      actorUserId: 'member-1',
      supportUserId: 'support-1',
      reason: 'Need help',
      expiresAt: '2026-06-26T13:25:00.000Z',
    }),
    (error: unknown) => {
      if (!(error instanceof SupportElevationPolicyError)) {
        return false;
      }

      return error.code === 'ADMIN_ROLE_REQUIRED';
    },
  );

  await service.grantElevation({
    tenantId: tenant.id,
    officeId: office.id,
    actorUserId: 'principal-1',
    supportUserId: 'support-1',
    reason: 'Investigate delivery issue',
    expiresAt: '2026-06-26T13:25:00.000Z',
  });

  await assert.rejects(
    service.grantElevation({
      tenantId: tenant.id,
      officeId: office.id,
      actorUserId: 'principal-1',
      supportUserId: 'support-1',
      reason: 'Duplicate',
      expiresAt: '2026-06-26T13:25:00.000Z',
    }),
    (error: unknown) => {
      if (!(error instanceof SupportElevationPolicyError)) {
        return false;
      }

      return error.code === 'ACTIVE_ELEVATION_EXISTS';
    },
  );
});

test('exposes controlled support elevation SQL storage', () => {
  assert.match(supportElevationSchemaSql, /create table support_action/i);
  assert.match(supportElevationSchemaSql, /support_user_id text not null/i);
  assert.match(supportElevationSchemaSql, /status text not null/i);
  assert.match(supportElevationSchemaSql, /expires_at timestamptz not null/i);
  assert.match(supportElevationSchemaSql, /support_action_active_idx/i);
});
