import { randomUUID } from 'node:crypto';

import type { AuthRole, Membership } from '@sovereign/contracts';
import type {
  DeviceRecord,
  HardwareKeyRecord,
  HardwareKeyType,
  RestrictedAccessAssertion,
  RestrictedSessionRecord,
  RestrictedSessionStatus,
} from '@sovereign/contracts';

import { AuditEventService } from '../audit';
import { InMemoryDeviceRepository } from '../device';
import { InMemoryTenancyRepository } from '../tenancy';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

export class HardwareKeyPolicyError extends Error {
  constructor(
    public readonly code:
      | 'RESTRICTED_MEMBERSHIP_REQUIRED'
      | 'HARDWARE_KEY_NOT_FOUND'
      | 'HARDWARE_KEY_REVOKED'
      | 'APPROVED_DEVICE_REQUIRED'
      | 'RESTRICTED_SESSION_REQUIRED'
      | 'RESTRICTED_SESSION_REVOKED_KEY',
    message: string,
  ) {
    super(message);
    this.name = 'HardwareKeyPolicyError';
  }
}

export class InMemoryHardwareKeyRepository {
  private readonly keys = new Map<string, HardwareKeyRecord>();

  async create(key: HardwareKeyRecord): Promise<void> {
    this.keys.set(key.id, cloneHardwareKeyRecord(key));
  }

  async save(key: HardwareKeyRecord): Promise<void> {
    this.keys.set(key.id, cloneHardwareKeyRecord(key));
  }

  async getById(id: string): Promise<HardwareKeyRecord | null> {
    const key = this.keys.get(id);
    return key ? cloneHardwareKeyRecord(key) : null;
  }

  async listByUser(
    tenantId: string,
    userId: string,
  ): Promise<HardwareKeyRecord[]> {
    return Array.from(this.keys.values())
      .filter((key) => key.tenantId === tenantId && key.userId === userId)
      .map((key) => cloneHardwareKeyRecord(key));
  }
}

export class InMemoryRestrictedSessionRepository {
  private readonly sessions = new Map<string, RestrictedSessionRecord>();

  async create(session: RestrictedSessionRecord): Promise<void> {
    this.sessions.set(session.id, cloneRestrictedSessionRecord(session));
  }

  async findLatestByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<RestrictedSessionRecord | null> {
    const sessions = Array.from(this.sessions.values())
      .filter((session) => session.tenantId === tenantId && session.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    const latest = sessions[0];
    return latest ? cloneRestrictedSessionRecord(latest) : null;
  }
}

type TenancyRepository = Pick<
  InMemoryTenancyRepository,
  'findMembershipByTenantAndUser'
>;

type DeviceRepository = Pick<InMemoryDeviceRepository, 'getById'>;

type HardwareKeyRepository = Pick<
  InMemoryHardwareKeyRepository,
  'create' | 'save' | 'getById' | 'listByUser'
>;

type RestrictedSessionRepository = Pick<
  InMemoryRestrictedSessionRepository,
  'create' | 'findLatestByTenantAndUser'
>;

type RegisterKeyInput = {
  tenantId: string;
  userId: string;
  actorUserId: string;
  deviceId: string;
  type: HardwareKeyType;
  label: string;
  isBackup: boolean;
};

type RevokeKeyInput = {
  tenantId: string;
  actorUserId: string;
  keyId: string;
  reason?: string;
};

type ActivateRestrictedSessionInput = {
  tenantId: string;
  officeId: string;
  userId: string;
  hardwareKeyId: string;
  deviceId: string;
};

type GetRestrictedSessionStatusInput = {
  tenantId: string;
  userId: string;
  now?: string;
};

export class HardwareKeyRegistryService {
  constructor(
    private readonly repository: HardwareKeyRepository,
    private readonly tenancyRepository: TenancyRepository,
    private readonly deviceRepository: DeviceRepository,
    private readonly auditService: AuditEventService,
    private readonly clock: Clock = defaultClock,
  ) {}

  async registerKey(input: RegisterKeyInput): Promise<HardwareKeyRecord> {
    const membership = await this.requireRestrictedEligibleMembership(
      input.tenantId,
      input.userId,
    );
    if (membership.userId !== input.actorUserId) {
      throw new HardwareKeyPolicyError(
        'RESTRICTED_MEMBERSHIP_REQUIRED',
        'Restricted members may only register keys for their own membership in this slice.',
      );
    }

    const key: HardwareKeyRecord = {
      id: randomUUID(),
      tenantId: membership.tenantId,
      officeId: membership.officeId,
      userId: membership.userId,
      deviceId: input.deviceId,
      type: input.type,
      label: input.label,
      isBackup: input.isBackup,
      status: 'active',
      createdAt: this.clock.now().toISOString(),
    };

    await this.repository.create(key);
    await this.auditService.writeEvent({
      tenantId: key.tenantId,
      officeId: key.officeId,
      actorId: input.actorUserId,
      type: 'restricted.hardware_key_registered',
      metadata: {
        hardwareKeyId: key.id,
        userId: key.userId,
        deviceId: key.deviceId,
        isBackup: key.isBackup,
      },
    });

    return cloneHardwareKeyRecord(key);
  }

  async revokeKey(input: RevokeKeyInput): Promise<HardwareKeyRecord> {
    const key = await this.requireActiveKey(input.keyId, input.tenantId);
    if (key.userId !== input.actorUserId) {
      throw new HardwareKeyPolicyError(
        'RESTRICTED_MEMBERSHIP_REQUIRED',
        'Restricted members may only revoke their own keys in this slice.',
      );
    }

    const revokedKey =
      input.reason === undefined
        ? {
            ...key,
            status: 'revoked' as const,
            revokedAt: this.clock.now().toISOString(),
          }
        : {
            ...key,
            status: 'revoked' as const,
            revokedAt: this.clock.now().toISOString(),
            revocationReason: input.reason,
          };

    await this.repository.save(revokedKey);
    await this.auditService.writeEvent({
      tenantId: revokedKey.tenantId,
      officeId: revokedKey.officeId,
      actorId: input.actorUserId,
      type: 'restricted.hardware_key_revoked',
      metadata:
        input.reason === undefined
          ? {
              hardwareKeyId: revokedKey.id,
              userId: revokedKey.userId,
            }
          : {
              hardwareKeyId: revokedKey.id,
              userId: revokedKey.userId,
              reason: input.reason,
            },
    });

    return cloneHardwareKeyRecord(revokedKey);
  }

  async getKey(keyId: string): Promise<HardwareKeyRecord | null> {
    return this.repository.getById(keyId);
  }

  async listUserKeyIds(tenantId: string, userId: string): Promise<string[]> {
    const keys = await this.repository.listByUser(tenantId, userId);
    return keys.filter((key) => key.status !== 'revoked').map((key) => key.id);
  }

  async assertApprovedDevice(
    tenantId: string,
    deviceId: string,
  ): Promise<DeviceRecord> {
    const device = await this.deviceRepository.getById(deviceId);
    if (!device || device.tenantId !== tenantId || device.status !== 'approved') {
      throw new HardwareKeyPolicyError(
        'APPROVED_DEVICE_REQUIRED',
        'Restricted sessions require an approved device.',
      );
    }

    return device;
  }

  private async requireActiveKey(
    keyId: string,
    tenantId: string,
  ): Promise<HardwareKeyRecord> {
    const key = await this.repository.getById(keyId);
    if (!key || key.tenantId !== tenantId) {
      throw new HardwareKeyPolicyError(
        'HARDWARE_KEY_NOT_FOUND',
        'Hardware key does not exist for this tenant.',
      );
    }

    if (key.status === 'revoked') {
      throw new HardwareKeyPolicyError(
        'HARDWARE_KEY_REVOKED',
        'Hardware key has been revoked.',
      );
    }

    return key;
  }

  private async requireRestrictedEligibleMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership = await this.tenancyRepository.findMembershipByTenantAndUser(
      tenantId,
      userId,
    );

    if (!membership || membership.status !== 'active' || !isRestrictedEligible(membership.role)) {
      throw new HardwareKeyPolicyError(
        'RESTRICTED_MEMBERSHIP_REQUIRED',
        'Only active restricted-eligible memberships may manage hardware keys.',
      );
    }

    return membership;
  }
}

export class RestrictedSessionService {
  constructor(
    private readonly repository: RestrictedSessionRepository,
    private readonly hardwareKeyService: HardwareKeyRegistryService,
    private readonly tenancyRepository: TenancyRepository,
    private readonly auditService: AuditEventService,
    private readonly clock: Clock = defaultClock,
    private readonly sessionDurationMinutes = 10,
  ) {}

  async activateRestrictedSession(
    input: ActivateRestrictedSessionInput,
  ): Promise<RestrictedSessionStatus> {
    const membership = await this.requireRestrictedEligibleMembership(
      input.tenantId,
      input.userId,
    );

    const key = await this.hardwareKeyService.getKey(input.hardwareKeyId);
    if (!key || key.tenantId !== input.tenantId || key.userId !== input.userId) {
      await this.auditService.writeEvent({
        tenantId: input.tenantId,
        officeId: input.officeId,
        actorId: input.userId,
        type: 'restricted.session_activation_denied',
        metadata: {
          hardwareKeyId: input.hardwareKeyId,
          reason: 'not_enrolled',
        },
      });
      throw new HardwareKeyPolicyError(
        'RESTRICTED_SESSION_REQUIRED',
        'Restricted session activation requires an enrolled hardware key.',
      );
    }

    if (key.status === 'revoked') {
      await this.auditService.writeEvent({
        tenantId: input.tenantId,
        officeId: input.officeId,
        actorId: input.userId,
        type: 'restricted.session_activation_denied',
        metadata: {
          hardwareKeyId: input.hardwareKeyId,
          reason: 'revoked_key',
        },
      });
      throw new HardwareKeyPolicyError(
        'RESTRICTED_SESSION_REVOKED_KEY',
        'Restricted session activation cannot use a revoked hardware key.',
      );
    }

    const device = await this.hardwareKeyService.assertApprovedDevice(
      input.tenantId,
      input.deviceId,
    );
    if (device.userId !== input.userId || device.officeId !== input.officeId) {
      await this.auditService.writeEvent({
        tenantId: input.tenantId,
        officeId: input.officeId,
        actorId: input.userId,
        type: 'restricted.session_activation_denied',
        metadata: {
          hardwareKeyId: input.hardwareKeyId,
          deviceId: input.deviceId,
          reason: 'device_mismatch',
        },
      });
      throw new HardwareKeyPolicyError(
        'APPROVED_DEVICE_REQUIRED',
        'Restricted sessions require an approved device for the same office and user.',
      );
    }
    const createdAt = this.clock.now();
    const expiresAt = new Date(
      createdAt.getTime() + this.sessionDurationMinutes * 60_000,
    ).toISOString();

    await this.repository.create({
      id: randomUUID(),
      tenantId: membership.tenantId,
      officeId: membership.officeId,
      userId: membership.userId,
      deviceId: device.id,
      hardwareKeyId: key.id,
      expiresAt,
      createdAt: createdAt.toISOString(),
    });

    await this.auditService.writeEvent({
      tenantId: membership.tenantId,
      officeId: membership.officeId,
      actorId: membership.userId,
      type: 'restricted.session_activated',
      metadata: {
        hardwareKeyId: key.id,
        deviceId: device.id,
        expiresAt,
      },
    });

    return {
      active: true,
      expiresAt,
    };
  }

  async getRestrictedSessionStatus(
    input: GetRestrictedSessionStatusInput,
  ): Promise<RestrictedSessionStatus> {
    const session = await this.repository.findLatestByTenantAndUser(
      input.tenantId,
      input.userId,
    );
    if (!session) {
      return {
        active: false,
        reason: 'not_enrolled',
      };
    }

    const key = await this.hardwareKeyService.getKey(session.hardwareKeyId);
    if (!key || key.status === 'revoked') {
      return {
        active: false,
        reason: 'revoked_key',
      };
    }

    const now = input.now ? new Date(input.now) : this.clock.now();
    if (new Date(session.expiresAt).getTime() <= now.getTime()) {
      return {
        active: false,
        reason: 'timeout',
      };
    }

    return {
      active: true,
      expiresAt: session.expiresAt,
    };
  }

  private async requireRestrictedEligibleMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership = await this.tenancyRepository.findMembershipByTenantAndUser(
      tenantId,
      userId,
    );

    if (!membership || membership.status !== 'active' || !isRestrictedEligible(membership.role)) {
      throw new HardwareKeyPolicyError(
        'RESTRICTED_MEMBERSHIP_REQUIRED',
        'Restricted sessions require an active restricted-eligible membership.',
      );
    }

    return membership;
  }
}

export class RestrictedAccessGuard {
  constructor(
    private readonly restrictedSessionService: RestrictedSessionService,
  ) {}

  async assertRestrictedAccess(
    input: RestrictedAccessAssertion,
  ): Promise<void> {
    if (input.conversationTier !== 'restricted') {
      return;
    }

    const status = await this.restrictedSessionService.getRestrictedSessionStatus(
      input.now === undefined
        ? {
            tenantId: input.tenantId,
            userId: input.userId,
          }
        : {
            tenantId: input.tenantId,
            userId: input.userId,
            now: input.now,
          },
    );

    if (status.active) {
      return;
    }

    if (status.reason === 'revoked_key') {
      throw new HardwareKeyPolicyError(
        'RESTRICTED_SESSION_REVOKED_KEY',
        'Restricted access requires re-entry after key revocation.',
      );
    }

    throw new HardwareKeyPolicyError(
      'RESTRICTED_SESSION_REQUIRED',
      'Restricted access requires an active restricted session.',
    );
  }
}

function isRestrictedEligible(role: AuthRole): boolean {
  return (
    role === 'principal' ||
    role === 'office_admin' ||
    role === 'restricted_member'
  );
}

function cloneHardwareKeyRecord(key: HardwareKeyRecord): HardwareKeyRecord {
  return { ...key };
}

function cloneRestrictedSessionRecord(
  session: RestrictedSessionRecord,
): RestrictedSessionRecord {
  return { ...session };
}
