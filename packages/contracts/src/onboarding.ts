import type {
  AuthRole,
  KycStatus,
  MemberOnboardingStatus,
  MembershipStatus,
} from './auth';

export type MemberLifecycleRecord = {
  membershipId: string;
  tenantId: string;
  officeId: string;
  userId: string;
  role: AuthRole;
  membershipStatus: MembershipStatus;
  onboardingStatus: MemberOnboardingStatus;
  kycStatus: KycStatus;
  updatedAt: string;
};

export type UpdateMemberLifecycleInput = {
  tenantId: string;
  userId: string;
  actorRole: AuthRole;
  onboardingStatus?: MemberOnboardingStatus;
  kycStatus?: KycStatus;
  membershipStatus?: MembershipStatus;
};
