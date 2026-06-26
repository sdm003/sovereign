import type { ConversationTier } from './conversation';

export type HardwareKeyType = 'yubikey' | 'passkey';

export type HardwareKeyStatus = 'active' | 'revoked';

export type HardwareKeyRecord = {
  id: string;
  tenantId: string;
  officeId: string;
  userId: string;
  deviceId: string;
  type: HardwareKeyType;
  label: string;
  isBackup: boolean;
  status: HardwareKeyStatus;
  createdAt: string;
  revokedAt?: string;
  revocationReason?: string;
};

export type RestrictedSessionRecord = {
  id: string;
  tenantId: string;
  officeId: string;
  userId: string;
  deviceId: string;
  hardwareKeyId: string;
  expiresAt: string;
  createdAt: string;
};

export type RestrictedSessionStatusReason =
  | 'timeout'
  | 'revoked_key'
  | 'not_enrolled';

export type RestrictedSessionStatus = {
  active: boolean;
  expiresAt?: string;
  reason?: RestrictedSessionStatusReason;
};

export type RestrictedAccessAssertion = {
  tenantId: string;
  officeId: string;
  userId: string;
  conversationTier: ConversationTier;
  now?: string;
};
