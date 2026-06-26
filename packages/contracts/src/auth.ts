export type AuthRole =
  | 'principal'
  | 'office_admin'
  | 'member'
  | 'restricted_member'
  | 'guest';

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
  role: AuthRole;
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
