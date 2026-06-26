import type {
  AuthRole,
  KycStatus,
  MemberOnboardingStatus,
  MembershipStatus,
} from './auth';

export type Tenant = {
  id: string;
  name: string;
  createdAt: string;
};

export type Office = {
  id: string;
  tenantId: string;
  name: string;
  createdAt: string;
};

export type Membership = {
  id: string;
  tenantId: string;
  officeId: string;
  userId: string;
  role: AuthRole;
  status: MembershipStatus;
  onboardingStatus: MemberOnboardingStatus;
  kycStatus: KycStatus;
  createdAt: string;
};

export type AuthContextResponse = {
  tenantId: string;
  officeId: string;
  userId: string;
  role: AuthRole;
  membershipStatus: MembershipStatus;
};
