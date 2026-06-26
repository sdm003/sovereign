export type SupportElevationStatus =
  | 'not_elevated'
  | 'pending'
  | 'active'
  | 'revoked';

export type SupportContentAccess = 'denied' | 'elevated';

export type SupportElevationRecord = {
  id: string;
  tenantId: string;
  officeId: string;
  supportUserId: string;
  status: Exclude<SupportElevationStatus, 'not_elevated'>;
  reason: string;
  createdAt: string;
  contentAccess: SupportContentAccess;
  requestedBy?: string;
  grantedBy?: string;
  grantedAt?: string;
  expiresAt?: string;
  revokedBy?: string;
  revokedAt?: string;
  revocationReason?: string;
};

export type SupportElevationStatusView = {
  tenantId: string;
  officeId: string;
  supportUserId: string;
  status: SupportElevationStatus;
  contentAccess: SupportContentAccess;
  reason?: string;
  requestedBy?: string;
  grantedBy?: string;
  expiresAt?: string;
  revokedBy?: string;
};

export type RequestSupportElevationInput = {
  tenantId: string;
  officeId: string;
  supportUserId: string;
  requestedBy: string;
  reason: string;
  expiresAt: string;
};

export type GrantSupportElevationInput = {
  tenantId: string;
  officeId: string;
  actorUserId: string;
  supportUserId: string;
  reason: string;
  expiresAt: string;
};

export type ApproveSupportElevationInput = {
  tenantId: string;
  officeId: string;
  actorUserId: string;
  supportElevationId: string;
  expiresAt: string;
};

export type RevokeSupportElevationInput = {
  tenantId: string;
  officeId: string;
  actorUserId: string;
  supportUserId: string;
  reason: string;
};
