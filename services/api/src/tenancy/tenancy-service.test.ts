import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuthContextResponse } from '@sovereign/contracts';

import {
  InMemoryTenancyRepository,
  TenancyConstraintError,
  TenancyNotFoundError,
  TenancyService,
  tenancySchemaSql,
} from './index';

test('creates a tenant, office, and membership and resolves auth context', async () => {
  const repository = new InMemoryTenancyRepository();
  const service = new TenancyService(repository);

  const tenant = await service.createTenant({ name: 'Family Office Alpha' });
  const office = await service.createOffice({
    tenantId: tenant.id,
    name: 'Alpha Office',
  });
  await service.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'user-1',
    role: 'office_admin',
    status: 'active',
  });

  const authContext: AuthContextResponse = await service.resolveAuthContext({
    tenantId: tenant.id,
    userId: 'user-1',
  });

  assert.deepEqual(authContext, {
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'user-1',
    role: 'office_admin',
    membershipStatus: 'active',
  });
});

test('enforces one office per tenant in V1', async () => {
  const repository = new InMemoryTenancyRepository();
  const service = new TenancyService(repository);

  const tenant = await service.createTenant({ name: 'Family Office Beta' });
  await service.createOffice({
    tenantId: tenant.id,
    name: 'Beta Office',
  });

  await assert.rejects(
    service.createOffice({
      tenantId: tenant.id,
      name: 'Second Beta Office',
    }),
    (error: unknown) => {
      assert.ok(error instanceof TenancyConstraintError);
      return error.code === 'TENANT_OFFICE_ALREADY_EXISTS';
    },
  );
});

test('rejects membership creation when office and tenant do not match', async () => {
  const repository = new InMemoryTenancyRepository();
  const service = new TenancyService(repository);

  const tenantA = await service.createTenant({ name: 'Tenant A' });
  const tenantB = await service.createTenant({ name: 'Tenant B' });
  const officeB = await service.createOffice({
    tenantId: tenantB.id,
    name: 'Tenant B Office',
  });

  await assert.rejects(
    service.createMembership({
      tenantId: tenantA.id,
      officeId: officeB.id,
      userId: 'user-2',
      role: 'member',
      status: 'pending',
    }),
    (error: unknown) => {
      assert.ok(error instanceof TenancyConstraintError);
      return error.code === 'OFFICE_TENANT_MISMATCH';
    },
  );
});

test('fails auth-context resolution for unknown membership', async () => {
  const repository = new InMemoryTenancyRepository();
  const service = new TenancyService(repository);

  const tenant = await service.createTenant({ name: 'Tenant Gamma' });
  await service.createOffice({
    tenantId: tenant.id,
    name: 'Gamma Office',
  });

  await assert.rejects(
    service.resolveAuthContext({
      tenantId: tenant.id,
      userId: 'missing-user',
    }),
    (error: unknown) => {
      assert.ok(error instanceof TenancyNotFoundError);
      return error.code === 'MEMBERSHIP_NOT_FOUND';
    },
  );
});

test('exposes the baseline SQL schema for tenant, office, and membership tables', () => {
  assert.match(tenancySchemaSql, /create table tenant/i);
  assert.match(tenancySchemaSql, /create table office/i);
  assert.match(tenancySchemaSql, /create table membership/i);
  assert.match(tenancySchemaSql, /tenant_id uuid not null unique/i);
});
