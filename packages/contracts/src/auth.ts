export type AuthRole =
  | 'principal'
  | 'office_admin'
  | 'member'
  | 'restricted_member'
  | 'guest';

export type MembershipStatus =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'removed';

export type MemberOnboardingStatus =
  | 'invited'
  | 'pending_kyc'
  | 'active'
  | 'suspended'
  | 'removed';

export type KycStatus =
  | 'not_started'
  | 'pending'
  | 'approved'
  | 'failed';

export type InvitationStatus =
  | 'pending'
  | 'completed'
  | 'expired'
  | 'revoked';

export type DeviceMetadata = {
  platform: 'ios' | 'web';
  deviceName?: string;
};

export type AuthContext = {
  tenantId: string;
  officeId: string;
  userId: string;
  role: AuthRole;
  membershipStatus: MembershipStatus;
};

export type IssueInvitationRequest = {
  tenantId: string;
  officeId: string;
  userId: string;
  email: string;
  role: AuthRole;
  expiresAt: string;
};

export type IssueInvitationResponse = {
  invitationId: string;
  token: string;
  expiresAt: string;
};

export type CompleteInviteAuthRequest = {
  token: string;
  deviceMetadata?: DeviceMetadata;
};

export type CompleteInviteAuthResponse = {
  accessToken: string;
  refreshToken: string;
  authContext: AuthContext;
};
