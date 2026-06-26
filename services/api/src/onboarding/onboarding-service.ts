import type {
  MemberLifecycleRecord,
  UpdateMemberLifecycleInput,
} from '@sovereign/contracts';
import type { AuthRole, KycStatus, MemberOnboardingStatus } from '@sovereign/contracts';
import type { Membership, MembershipStatus } from '@sovereign/contracts';

import {
  InMemoryTenancyRepository,
  TenancyNotFoundError,
} from '../tenancy';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

export class MemberLifecycleError extends Error {
  constructor(
    public readonly code:
      | 'ADMIN_ROLE_REQUIRED'
      | 'KYC_APPROVAL_REQUIRED'
      | 'GUEST_KYC_NOT_SUPPORTED'
      | 'INVALID_ONBOARDING_TRANSITION',
    message: string,
  ) {
    super(message);
    this.name = 'MemberLifecycleError';
  }
}

type TenancyRepository = Pick<
  InMemoryTenancyRepository,
  'findMembershipByTenantAndUser' | 'saveMembership'
>;

export class OnboardingService {
  constructor(
    private readonly repository: TenancyRepository,
    private readonly clock: Clock = defaultClock,
  ) {}

  async updateMemberLifecycle(
    input: UpdateMemberLifecycleInput,
  ): Promise<MemberLifecycleRecord> {
    if (!isAdminActor(input.actorRole)) {
      throw new MemberLifecycleError(
        'ADMIN_ROLE_REQUIRED',
        'Only principal or office_admin actors may change member lifecycle state.',
      );
    }

    const membership = await this.repository.findMembershipByTenantAndUser(
      input.tenantId,
      input.userId,
    );

    if (!membership) {
      throw new TenancyNotFoundError(
        'MEMBERSHIP_NOT_FOUND',
        'Membership does not exist for this tenant and user.',
      );
    }

    if (membership.role === 'guest') {
      throw new MemberLifecycleError(
        'GUEST_KYC_NOT_SUPPORTED',
        'Guest memberships are excluded from internal-member KYC lifecycle handling.',
      );
    }

    const nextKycStatus = input.kycStatus ?? membership.kycStatus;
    const nextOnboardingStatus =
      input.onboardingStatus ?? membership.onboardingStatus;
    const nextMembershipStatus =
      input.membershipStatus ?? membership.status;

    validateLifecycleTransition(
      membership,
      nextOnboardingStatus,
      nextKycStatus,
      nextMembershipStatus,
    );

    const updatedMembership: Membership = {
      ...membership,
      onboardingStatus: nextOnboardingStatus,
      kycStatus: nextKycStatus,
      status: nextMembershipStatus,
      createdAt: membership.createdAt,
    };

    await this.repository.saveMembership(updatedMembership);

    return {
      membershipId: updatedMembership.id,
      tenantId: updatedMembership.tenantId,
      officeId: updatedMembership.officeId,
      userId: updatedMembership.userId,
      role: updatedMembership.role,
      membershipStatus: updatedMembership.status,
      onboardingStatus: updatedMembership.onboardingStatus,
      kycStatus: updatedMembership.kycStatus,
      updatedAt: this.clock.now().toISOString(),
    };
  }
}

function isAdminActor(role: AuthRole): boolean {
  return role === 'principal' || role === 'office_admin';
}

function validateLifecycleTransition(
  membership: Membership,
  onboardingStatus: MemberOnboardingStatus,
  kycStatus: KycStatus,
  membershipStatus: MembershipStatus,
): void {
  if (onboardingStatus === 'active') {
    if (kycStatus !== 'approved') {
      throw new MemberLifecycleError(
        'KYC_APPROVAL_REQUIRED',
        'KYC approval is required before activating an internal member.',
      );
    }

    if (membershipStatus !== 'active') {
      throw new MemberLifecycleError(
        'INVALID_ONBOARDING_TRANSITION',
        'Active onboarding status requires active membership status.',
      );
    }
  }

  if (onboardingStatus === 'pending_kyc' && membershipStatus === 'active') {
    throw new MemberLifecycleError(
      'INVALID_ONBOARDING_TRANSITION',
      'Pending KYC members cannot be marked active.',
    );
  }

  if (
    (onboardingStatus === 'suspended' && membershipStatus !== 'suspended') ||
    (onboardingStatus === 'removed' && membershipStatus !== 'removed')
  ) {
    throw new MemberLifecycleError(
      'INVALID_ONBOARDING_TRANSITION',
      'Suspended and removed onboarding states must match membership status.',
    );
  }
}
