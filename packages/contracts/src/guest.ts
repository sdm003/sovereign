export type GuestIdentityStatus = 'active' | 'revoked';

export type GuestIdentity = {
  id: string;
  tenantId: string;
  officeId: string;
  userId: string;
  displayName?: string;
  status: GuestIdentityStatus;
  createdBy: string;
  createdAt: string;
};

export type GuestScope = {
  id: string;
  tenantId: string;
  officeId: string;
  guestUserId: string;
  conversationId: string;
  grantedBy: string;
  createdAt: string;
  revokedAt?: string;
  revokedBy?: string;
};

export type CreateGuestIdentityRequest = {
  tenantId: string;
  officeId: string;
  actorUserId: string;
  guestUserId: string;
  displayName?: string;
};

export type GrantGuestScopeRequest = {
  tenantId: string;
  officeId: string;
  actorUserId: string;
  guestUserId: string;
  conversationIds: string[];
};

export type RevokeGuestScopeRequest = {
  tenantId: string;
  officeId: string;
  actorUserId: string;
  guestUserId: string;
  conversationId: string;
};

export type GuestDirectoryEntry = {
  guestId: string;
  userId: string;
  displayName?: string;
  status: GuestIdentityStatus;
};
