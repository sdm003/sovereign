import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryTenancyRepository, TenancyService } from '../tenancy';
import {
  MemberLifecycleError,
  OnboardingService,
  onboardingMembershipAlterSql,
} from './index';

async function seedInternalMember() {
  const repository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(repository);

  const tenant = await tenancyService.createTenant({ name: 'Onboarding Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Onboarding Office',
  });
  const membership = await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    role: 'member',
    status: 'pending',
  });

  return { repository, tenant, office, membership };
}

test('moves an internal member from invited to pending KYC and then active only after KYC approval', async () => {
  const { repository, tenant } = await seedInternalMember();
  const service = new OnboardingService(repository);

  const pendingKyc = await service.updateMemberLifecycle({
    tenantId: tenant.id,
    userId: 'member-1',
    actorRole: 'office_admin',
    onboardingStatus: 'pending_kyc',
    kycStatus: 'pending',
  });

  assert.equal(pendingKyc.onboardingStatus, 'pending_kyc');
  assert.equal(pendingKyc.kycStatus, 'pending');
  assert.equal(pendingKyc.membershipStatus, 'pending');

  const active = await service.updateMemberLifecycle({
    tenantId: tenant.id,
    userId: 'member-1',
    actorRole: 'office_admin',
    onboardingStatus: 'active',
    kycStatus: 'approved',
    membershipStatus: 'active',
  });

  assert.equal(active.onboardingStatus, 'active');
  assert.equal(active.kycStatus, 'approved');
  assert.equal(active.membershipStatus, 'active');
});

test('rejects activation when KYC is not approved', async () => {
  const { repository, tenant } = await seedInternalMember();
  const service = new OnboardingService(repository);

  await assert.rejects(
    service.updateMemberLifecycle({
      tenantId: tenant.id,
      userId: 'member-1',
      actorRole: 'office_admin',
      onboardingStatus: 'active',
      membershipStatus: 'active',
      kycStatus: 'pending',
    }),
    (error: unknown) => {
      assert.ok(error instanceof MemberLifecycleError);
      if (!(error instanceof MemberLifecycleError)) {
        return false;
      }
      return error.code === 'KYC_APPROVAL_REQUIRED';
    },
  );
});

test('rejects guest members from KYC-managed internal onboarding', async () => {
  const repository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(repository);
  const tenant = await tenancyService.createTenant({ name: 'Guest Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Guest Office',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'guest-1',
    role: 'guest',
    status: 'pending',
  });

  const service = new OnboardingService(repository);

  await assert.rejects(
    service.updateMemberLifecycle({
      tenantId: tenant.id,
      userId: 'guest-1',
      actorRole: 'office_admin',
      onboardingStatus: 'pending_kyc',
      kycStatus: 'pending',
    }),
    (error: unknown) => {
      assert.ok(error instanceof MemberLifecycleError);
      if (!(error instanceof MemberLifecycleError)) {
        return false;
      }
      return error.code === 'GUEST_KYC_NOT_SUPPORTED';
    },
  );
});

test('requires office-admin or principal actor for lifecycle transitions', async () => {
  const { repository, tenant } = await seedInternalMember();
  const service = new OnboardingService(repository);

  await assert.rejects(
    service.updateMemberLifecycle({
      tenantId: tenant.id,
      userId: 'member-1',
      actorRole: 'member',
      onboardingStatus: 'suspended',
      membershipStatus: 'suspended',
    }),
    (error: unknown) => {
      assert.ok(error instanceof MemberLifecycleError);
      if (!(error instanceof MemberLifecycleError)) {
        return false;
      }
      return error.code === 'ADMIN_ROLE_REQUIRED';
    },
  );
});

test('exposes the baseline SQL membership alteration for onboarding and KYC columns', () => {
  assert.match(onboardingMembershipAlterSql, /alter table membership/i);
  assert.match(onboardingMembershipAlterSql, /add column onboarding_status/i);
  assert.match(onboardingMembershipAlterSql, /add column kyc_status/i);
});
