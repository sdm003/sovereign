import { randomUUID } from 'node:crypto';

import type { AuthRole, Membership } from '@sovereign/contracts';
import type {
  RecoveryReplacementDeviceInput,
  RecoveryReplacementHardwareKeyInput,
  RecoveryRequestRecord,
} from '@sovereign/contracts';

import { AuditEventService } from '../audit';
import { DeviceRegistryService, SessionRegistryService } from '../device';
import {
  HardwareKeyRegistryService,
  HardwareKeyPolicyError,
  RestrictedSessionService,
} from '../restricted';
import { InMemoryTenancyRepository } from '../tenancy';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

export class RecoveryPolicyError extends Error {
  constructor(
    public readonly code:
      | 'ADMIN_ROLE_REQUIRED'
      | 'RECOVERY_REQUEST_NOT_FOUND'
      | 'RECOVERY_VERIFICATION_REQUIRED'
      | 'RECOVERY_CHANNEL_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'RecoveryPolicyError';
  }
}

export class InMemoryRecoveryRepository {
  private readonly requests = new Map<string, RecoveryRequestRecord>();

  async create(request: RecoveryRequestRecord): Promise<void> {
    this.requests.set(request.id, cloneRecoveryRequest(request));
  }

  async save(request: RecoveryRequestRecord): Promise<void> {
    this.requests.set(request.id, cloneRecoveryRequest(request));
  }

  async getById(id: string): Promise<RecoveryRequestRecord | null> {
    const request = this.requests.get(id);
    return request ? cloneRecoveryRequest(request) : null;
  }
}

type RecoveryRepository = Pick<
  InMemoryRecoveryRepository,
  'create' | 'save' | 'getById'
>;

type TenancyRepository = Pick<
  InMemoryTenancyRepository,
  'findMembershipByTenantAndUser'
>;

type RequestRecoveryInput = {
  tenantId: string;
  officeId: string;
  userId: string;
  reason: string;
  recoveryChannel: string;
};

type ApproveRecoveryInput = {
  tenantId: string;
  actorUserId: string;
  recoveryRequestId: string;
};

type VerifyRecoveryChannelInput = {
  tenantId: string;
  recoveryRequestId: string;
  verifiedBy: string;
  providedChannel: string;
};

type CompleteRecoveryInput = {
  tenantId: string;
  officeId: string;
  recoveryRequestId: string;
  actorUserId: string;
  replacementDevice: RecoveryReplacementDeviceInput;
  replacementHardwareKey: RecoveryReplacementHardwareKeyInput;
};

export class RecoveryService {
  constructor(
    private readonly repository: RecoveryRepository,
    private readonly tenancyRepository: TenancyRepository,
    private readonly deviceService: DeviceRegistryService,
    private readonly sessionRegistry: SessionRegistryService,
    private readonly hardwareKeyService: HardwareKeyRegistryService,
    private readonly restrictedSessionService: RestrictedSessionService,
    private readonly auditService: AuditEventService,
    private readonly clock: Clock = defaultClock,
  ) {}

  async requestRecovery(
    input: RequestRecoveryInput,
  ): Promise<RecoveryRequestRecord> {
    await this.requireMembership(input.tenantId, input.userId);

    const request: RecoveryRequestRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      officeId: input.officeId,
      userId: input.userId,
      status: 'requested',
      reason: input.reason,
      recoveryChannel: input.recoveryChannel,
      createdAt: this.clock.now().toISOString(),
    };

    await this.repository.create(request);
    await this.auditService.writeEvent({
      tenantId: request.tenantId,
      officeId: request.officeId,
      actorId: request.userId,
      type: 'recovery.requested',
      metadata: {
        recoveryRequestId: request.id,
        recoveryChannel: request.recoveryChannel,
      },
    });

    return cloneRecoveryRequest(request);
  }

  async approveRecovery(
    input: ApproveRecoveryInput,
  ): Promise<RecoveryRequestRecord> {
    const actor = await this.requireAdminMembership(
      input.tenantId,
      input.actorUserId,
    );
    const request = await this.requireRequest(input.recoveryRequestId, input.tenantId);
    const approvedAt = this.clock.now().toISOString();
    const approved: RecoveryRequestRecord = {
      ...request,
      status: 'verification_pending',
      approvedBy: actor.userId,
      approvedAt,
    };

    await this.repository.save(approved);
    await this.auditService.writeEvent({
      tenantId: approved.tenantId,
      officeId: approved.officeId,
      actorId: actor.userId,
      type: 'recovery.admin_approved',
      metadata: {
        recoveryRequestId: approved.id,
        userId: approved.userId,
      },
    });

    return cloneRecoveryRequest(approved);
  }

  async verifyRecoveryChannel(
    input: VerifyRecoveryChannelInput,
  ): Promise<RecoveryRequestRecord> {
    await this.requireAdminMembership(input.tenantId, input.verifiedBy);
    const request = await this.requireRequest(input.recoveryRequestId, input.tenantId);
    if (request.recoveryChannel !== input.providedChannel) {
      throw new RecoveryPolicyError(
        'RECOVERY_CHANNEL_MISMATCH',
        'Provided recovery channel does not match the registered recovery channel.',
      );
    }

    const verifiedAt = this.clock.now().toISOString();
    const verified: RecoveryRequestRecord = {
      ...request,
      recoveryChannelVerifiedAt: verifiedAt,
      verifiedBy: input.verifiedBy,
    };

    await this.repository.save(verified);
    await this.auditService.writeEvent({
      tenantId: verified.tenantId,
      officeId: verified.officeId,
      actorId: input.verifiedBy,
      type: 'recovery.sim_verified',
      metadata: {
        recoveryRequestId: verified.id,
        userId: verified.userId,
      },
    });

    return cloneRecoveryRequest(verified);
  }

  async completeRecovery(
    input: CompleteRecoveryInput,
  ): Promise<RecoveryRequestRecord> {
    await this.requireAdminMembership(input.tenantId, input.actorUserId);
    const request = await this.requireRequest(input.recoveryRequestId, input.tenantId);
    if (request.status !== 'verification_pending' || !request.recoveryChannelVerifiedAt) {
      throw new RecoveryPolicyError(
        'RECOVERY_VERIFICATION_REQUIRED',
        'Recovery completion requires admin approval and verified recovery channel.',
      );
    }

    const oldDeviceIds = await this.deviceService.listUserDeviceIds(
      input.tenantId,
      request.userId,
    );
    const oldKeyIds = await this.hardwareKeyService.listUserKeyIds(
      input.tenantId,
      request.userId,
    );

    for (const keyId of oldKeyIds) {
      try {
        await this.hardwareKeyService.revokeKey({
          tenantId: input.tenantId,
          actorUserId: request.userId,
          keyId,
          reason: 'recovery_completed',
        });
      } catch (error: unknown) {
        if (
          !(error instanceof HardwareKeyPolicyError) ||
          error.code !== 'HARDWARE_KEY_REVOKED'
        ) {
          throw error;
        }
      }
    }

    for (const deviceId of oldDeviceIds) {
      await this.deviceService.revokeDevice({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        deviceId,
        reason: 'Recovery completed',
      });
    }

    const replacementDevice = await this.deviceService.enrollDevice(
      input.replacementDevice.deviceName === undefined
        ? {
            tenantId: input.tenantId,
            userId: request.userId,
            platform: input.replacementDevice.platform,
            clientDeviceId: input.replacementDevice.clientDeviceId,
          }
        : {
            tenantId: input.tenantId,
            userId: request.userId,
            platform: input.replacementDevice.platform,
            clientDeviceId: input.replacementDevice.clientDeviceId,
            deviceName: input.replacementDevice.deviceName,
          },
    );
    const approvedDevice = await this.deviceService.approveDevice({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      deviceId: replacementDevice.id,
    });

    const replacementKey = await this.hardwareKeyService.registerKey({
      tenantId: input.tenantId,
      userId: request.userId,
      actorUserId: request.userId,
      deviceId: approvedDevice.id,
      type: input.replacementHardwareKey.type,
      label: input.replacementHardwareKey.label,
      isBackup: input.replacementHardwareKey.isBackup,
    });

    const completedAt = this.clock.now().toISOString();
    const completed: RecoveryRequestRecord = {
      ...request,
      status: 'completed',
      completedAt,
      replacementDeviceId: approvedDevice.id,
      replacementHardwareKeyId: replacementKey.id,
      reissuedDeviceId: approvedDevice.id,
      reissuedHardwareKeyId: replacementKey.id,
    };

    await this.repository.save(completed);
    await this.auditService.writeEvent({
      tenantId: completed.tenantId,
      officeId: completed.officeId,
      actorId: input.actorUserId,
      type: 'recovery.completed',
      metadata: {
        recoveryRequestId: completed.id,
        replacementDeviceId: approvedDevice.id,
        replacementHardwareKeyId: replacementKey.id,
      },
    });

    return cloneRecoveryRequest(completed);
  }

  private async requireRequest(
    recoveryRequestId: string,
    tenantId: string,
  ): Promise<RecoveryRequestRecord> {
    const request = await this.repository.getById(recoveryRequestId);
    if (!request || request.tenantId !== tenantId) {
      throw new RecoveryPolicyError(
        'RECOVERY_REQUEST_NOT_FOUND',
        'Recovery request does not exist for this tenant.',
      );
    }

    return request;
  }

  private async requireMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership = await this.tenancyRepository.findMembershipByTenantAndUser(
      tenantId,
      userId,
    );
    if (!membership || membership.status !== 'active') {
      throw new RecoveryPolicyError(
        'RECOVERY_REQUEST_NOT_FOUND',
        'Active membership is required for governed recovery.',
      );
    }

    return membership;
  }

  private async requireAdminMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership = await this.requireMembership(tenantId, userId);
    if (!isAdminRole(membership.role)) {
      throw new RecoveryPolicyError(
        'ADMIN_ROLE_REQUIRED',
        'Only principal or office_admin actors may approve or complete recovery.',
      );
    }

    return membership;
  }
}

function isAdminRole(role: AuthRole): boolean {
  return role === 'principal' || role === 'office_admin';
}

function cloneRecoveryRequest(
  request: RecoveryRequestRecord,
): RecoveryRequestRecord {
  return { ...request };
}
