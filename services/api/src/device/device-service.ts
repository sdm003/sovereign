import { randomUUID } from 'node:crypto';

import type { AuthRole, Membership } from '@sovereign/contracts';
import type {
  AuthSessionRecord,
  DevicePlatform,
  DeviceRecord,
} from '@sovereign/contracts';

import { AuditEventService } from '../audit';
import { InMemoryTenancyRepository } from '../tenancy';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

export class DeviceRegistryError extends Error {
  constructor(
    public readonly code:
      | 'ADMIN_ROLE_REQUIRED'
      | 'MEMBERSHIP_NOT_FOUND'
      | 'INACTIVE_MEMBERSHIP_REQUIRED'
      | 'DEVICE_NOT_FOUND'
      | 'DEVICE_ALREADY_ENROLLED'
      | 'INVALID_DEVICE_TRANSITION',
    message: string,
  ) {
    super(message);
    this.name = 'DeviceRegistryError';
  }
}

export class InMemoryDeviceRepository {
  private readonly devices = new Map<string, DeviceRecord>();

  async create(device: DeviceRecord): Promise<void> {
    this.devices.set(device.id, cloneDeviceRecord(device));
  }

  async save(device: DeviceRecord): Promise<void> {
    this.devices.set(device.id, cloneDeviceRecord(device));
  }

  async getById(id: string): Promise<DeviceRecord | null> {
    const device = this.devices.get(id);
    return device ? cloneDeviceRecord(device) : null;
  }

  async findByTenantUserAndClientDevice(
    tenantId: string,
    userId: string,
    clientDeviceId: string,
  ): Promise<DeviceRecord | null> {
    for (const device of this.devices.values()) {
      if (
        device.tenantId === tenantId &&
        device.userId === userId &&
        device.clientDeviceId === clientDeviceId
      ) {
        return cloneDeviceRecord(device);
      }
    }

    return null;
  }

  async listByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<DeviceRecord[]> {
    return Array.from(this.devices.values())
      .filter((device) => device.tenantId === tenantId && device.userId === userId)
      .map((device) => cloneDeviceRecord(device));
  }
}

export class InMemorySessionRepository {
  private readonly sessions = new Map<string, AuthSessionRecord>();

  async create(session: AuthSessionRecord): Promise<void> {
    this.sessions.set(session.id, cloneAuthSessionRecord(session));
  }

  async save(session: AuthSessionRecord): Promise<void> {
    this.sessions.set(session.id, cloneAuthSessionRecord(session));
  }

  async listByDevice(deviceId: string): Promise<AuthSessionRecord[]> {
    return Array.from(this.sessions.values())
      .filter((session) => session.deviceId === deviceId)
      .map((session) => cloneAuthSessionRecord(session));
  }

  async listByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<AuthSessionRecord[]> {
    return Array.from(this.sessions.values())
      .filter(
        (session) => session.tenantId === tenantId && session.userId === userId,
      )
      .map((session) => cloneAuthSessionRecord(session));
  }
}

type TenancyRepository = Pick<
  InMemoryTenancyRepository,
  'findMembershipByTenantAndUser'
>;

type DeviceRepository = Pick<
  InMemoryDeviceRepository,
  | 'create'
  | 'save'
  | 'getById'
  | 'findByTenantUserAndClientDevice'
  | 'listByTenantAndUser'
>;

type SessionRepository = Pick<
  InMemorySessionRepository,
  'create' | 'save' | 'listByDevice' | 'listByTenantAndUser'
>;

type EnrollDeviceInput = {
  tenantId: string;
  userId: string;
  platform: DevicePlatform;
  clientDeviceId: string;
  deviceName?: string;
};

type DeviceMutationInput = {
  tenantId: string;
  actorUserId: string;
  deviceId: string;
};

type RevokeDeviceInput = DeviceMutationInput & {
  reason?: string;
};

type IssueSessionInput = {
  tenantId: string;
  officeId: string;
  userId: string;
  deviceId: string;
};

export class SessionRegistryService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly clock: Clock = defaultClock,
  ) {}

  async issueSession(input: IssueSessionInput): Promise<AuthSessionRecord> {
    const session: AuthSessionRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      officeId: input.officeId,
      userId: input.userId,
      deviceId: input.deviceId,
      status: 'active',
      createdAt: this.clock.now().toISOString(),
    };

    await this.repository.create(session);
    return cloneAuthSessionRecord(session);
  }

  async revokeDeviceSessions(deviceId: string): Promise<number> {
    const sessions = await this.repository.listByDevice(deviceId);
    const revokedAt = this.clock.now().toISOString();
    let revokedCount = 0;

    for (const session of sessions) {
      if (session.status === 'revoked') {
        continue;
      }

      revokedCount += 1;
      await this.repository.save({
        ...session,
        status: 'revoked',
        revokedAt,
        revocationReason: 'device_revoked',
      });
    }

    return revokedCount;
  }

  async listSessionsByDevice(deviceId: string): Promise<AuthSessionRecord[]> {
    return this.repository.listByDevice(deviceId);
  }

  async revokeUserSessions(
    tenantId: string,
    userId: string,
    reason: string = 'guest_kill_switch',
  ): Promise<number> {
    const sessions = await this.repository.listByTenantAndUser(tenantId, userId);
    const revokedAt = this.clock.now().toISOString();
    let revokedCount = 0;

    for (const session of sessions) {
      if (session.status === 'revoked') {
        continue;
      }

      revokedCount += 1;
      await this.repository.save({
        ...session,
        status: 'revoked',
        revokedAt,
        revocationReason: reason,
      });
    }

    return revokedCount;
  }

  async listSessionsByUser(
    tenantId: string,
    userId: string,
  ): Promise<AuthSessionRecord[]> {
    return this.repository.listByTenantAndUser(tenantId, userId);
  }
}

export class DeviceRegistryService {
  constructor(
    private readonly repository: DeviceRepository,
    private readonly tenancyRepository: TenancyRepository,
    private readonly sessionRegistry: SessionRegistryService,
    private readonly auditService: AuditEventService,
    private readonly clock: Clock = defaultClock,
  ) {}

  async enrollDevice(input: EnrollDeviceInput): Promise<DeviceRecord> {
    const membership = await this.requireActiveMembership(
      input.tenantId,
      input.userId,
    );
    const existing = await this.repository.findByTenantUserAndClientDevice(
      input.tenantId,
      input.userId,
      input.clientDeviceId,
    );
    if (existing && existing.status !== 'revoked') {
      throw new DeviceRegistryError(
        'DEVICE_ALREADY_ENROLLED',
        'An active or pending device record already exists for this device identifier.',
      );
    }

    const device =
      input.deviceName === undefined
        ? {
            id: randomUUID(),
            tenantId: membership.tenantId,
            officeId: membership.officeId,
            userId: membership.userId,
            status: 'pending' as const,
            platform: input.platform,
            clientDeviceId: input.clientDeviceId,
            createdAt: this.clock.now().toISOString(),
          }
        : {
            id: randomUUID(),
            tenantId: membership.tenantId,
            officeId: membership.officeId,
            userId: membership.userId,
            status: 'pending' as const,
            platform: input.platform,
            clientDeviceId: input.clientDeviceId,
            deviceName: input.deviceName,
            createdAt: this.clock.now().toISOString(),
          };

    await this.repository.create(device);
    await this.auditService.writeEvent({
      tenantId: device.tenantId,
      officeId: device.officeId,
      actorId: membership.userId,
      type: 'device.enrolled',
      metadata: {
        deviceId: device.id,
        userId: device.userId,
        platform: device.platform,
        clientDeviceId: device.clientDeviceId,
      },
    });

    return cloneDeviceRecord(device);
  }

  async approveDevice(input: DeviceMutationInput): Promise<DeviceRecord> {
    const actor = await this.requireAdminMembership(
      input.tenantId,
      input.actorUserId,
    );
    const device = await this.requireDevice(input.deviceId, input.tenantId);

    if (device.status !== 'pending') {
      throw new DeviceRegistryError(
        'INVALID_DEVICE_TRANSITION',
        'Only pending devices may be approved.',
      );
    }

    const approvedDevice: DeviceRecord = {
      ...device,
      status: 'approved',
      approvedAt: this.clock.now().toISOString(),
      approvedBy: actor.userId,
    };
    await this.repository.save(approvedDevice);

    await this.auditService.writeEvent({
      tenantId: approvedDevice.tenantId,
      officeId: approvedDevice.officeId,
      actorId: actor.userId,
      type: 'device.approved',
      metadata: {
        deviceId: approvedDevice.id,
        userId: approvedDevice.userId,
      },
    });

    return cloneDeviceRecord(approvedDevice);
  }

  async revokeDevice(input: RevokeDeviceInput): Promise<DeviceRecord> {
    const actor = await this.requireAdminMembership(
      input.tenantId,
      input.actorUserId,
    );
    const device = await this.requireDevice(input.deviceId, input.tenantId);

    if (device.status === 'revoked') {
      throw new DeviceRegistryError(
        'INVALID_DEVICE_TRANSITION',
        'Revoked devices cannot be revoked again.',
      );
    }

    const revokedSessionCount = await this.sessionRegistry.revokeDeviceSessions(
      device.id,
    );
    const revokedDevice =
      input.reason === undefined
        ? {
            ...device,
            status: 'revoked' as const,
            revokedAt: this.clock.now().toISOString(),
            revokedBy: actor.userId,
          }
        : {
            ...device,
            status: 'revoked' as const,
            revokedAt: this.clock.now().toISOString(),
            revokedBy: actor.userId,
            revocationReason: input.reason,
          };

    await this.repository.save(revokedDevice);
    await this.auditService.writeEvent({
      tenantId: revokedDevice.tenantId,
      officeId: revokedDevice.officeId,
      actorId: actor.userId,
      type: 'device.revoked',
      metadata:
        input.reason === undefined
          ? {
              deviceId: revokedDevice.id,
              userId: revokedDevice.userId,
              revokedSessionCount,
            }
          : {
              deviceId: revokedDevice.id,
              userId: revokedDevice.userId,
              revokedSessionCount,
              reason: input.reason,
            },
    });

    return cloneDeviceRecord(revokedDevice);
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | null> {
    return this.repository.getById(deviceId);
  }

  async listUserDeviceIds(
    tenantId: string,
    userId: string,
  ): Promise<string[]> {
    const devices = await this.repository.listByTenantAndUser(tenantId, userId);
    return devices.filter((device) => device.status !== 'revoked').map((device) => device.id);
  }

  private async requireDevice(
    deviceId: string,
    tenantId: string,
  ): Promise<DeviceRecord> {
    const device = await this.repository.getById(deviceId);
    if (!device || device.tenantId !== tenantId) {
      throw new DeviceRegistryError(
        'DEVICE_NOT_FOUND',
        'Device does not exist for this tenant.',
      );
    }

    return device;
  }

  private async requireActiveMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership = await this.tenancyRepository.findMembershipByTenantAndUser(
      tenantId,
      userId,
    );

    if (!membership) {
      throw new DeviceRegistryError(
        'MEMBERSHIP_NOT_FOUND',
        'Membership does not exist for this tenant and user.',
      );
    }

    if (membership.status !== 'active') {
      throw new DeviceRegistryError(
        'INACTIVE_MEMBERSHIP_REQUIRED',
        'Only active memberships may enroll or manage devices.',
      );
    }

    return membership;
  }

  private async requireAdminMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership = await this.requireActiveMembership(tenantId, userId);

    if (!isAdminRole(membership.role)) {
      throw new DeviceRegistryError(
        'ADMIN_ROLE_REQUIRED',
        'Only principal or office_admin actors may approve or revoke devices.',
      );
    }

    return membership;
  }
}

function isAdminRole(role: AuthRole): boolean {
  return role === 'principal' || role === 'office_admin';
}

function cloneDeviceRecord(device: DeviceRecord): DeviceRecord {
  return { ...device };
}

function cloneAuthSessionRecord(
  session: AuthSessionRecord,
): AuthSessionRecord {
  return { ...session };
}
