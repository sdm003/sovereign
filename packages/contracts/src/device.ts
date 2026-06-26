export type DevicePlatform = 'ios' | 'web';

export type DeviceStatus = 'pending' | 'approved' | 'revoked';

export type DeviceRecord = {
  id: string;
  tenantId: string;
  officeId: string;
  userId: string;
  status: DeviceStatus;
  platform: DevicePlatform;
  clientDeviceId: string;
  createdAt: string;
  deviceName?: string;
  approvedAt?: string;
  approvedBy?: string;
  revokedAt?: string;
  revokedBy?: string;
  revocationReason?: string;
};

export type SessionStatus = 'active' | 'revoked';

export type AuthSessionRecord = {
  id: string;
  tenantId: string;
  officeId: string;
  userId: string;
  deviceId: string;
  status: SessionStatus;
  createdAt: string;
  revokedAt?: string;
  revocationReason?: string;
};
