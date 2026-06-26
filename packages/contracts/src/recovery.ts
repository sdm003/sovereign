import type { DevicePlatform } from './device';
import type { HardwareKeyType } from './restricted';

export type RecoveryRequestStatus =
  | 'requested'
  | 'verification_pending'
  | 'completed'
  | 'rejected';

export type RecoveryRequestRecord = {
  id: string;
  tenantId: string;
  officeId: string;
  userId: string;
  status: RecoveryRequestStatus;
  reason: string;
  recoveryChannel: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  recoveryChannelVerifiedAt?: string;
  verifiedBy?: string;
  completedAt?: string;
  replacementDeviceId?: string;
  replacementHardwareKeyId?: string;
  reissuedDeviceId?: string;
  reissuedHardwareKeyId?: string;
};

export type RecoveryReplacementDeviceInput = {
  platform: DevicePlatform;
  clientDeviceId: string;
  deviceName?: string;
};

export type RecoveryReplacementHardwareKeyInput = {
  type: HardwareKeyType;
  label: string;
  isBackup: boolean;
};
