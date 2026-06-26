import { randomUUID } from 'node:crypto';

import type {
  ApproveSupportElevationInput,
  GrantSupportElevationInput,
  Membership,
  RequestSupportElevationInput,
  RevokeSupportElevationInput,
  SupportElevationRecord,
  SupportElevationStatusView,
} from '@sovereign/contracts';

import type { AuditEventService } from '../audit';
import type { InMemoryTenancyRepository } from '../tenancy';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

export class SupportElevationPolicyError extends Error {
  constructor(
    public readonly code:
      | 'ADMIN_ROLE_REQUIRED'
      | 'ACTIVE_ELEVATION_EXISTS'
      | 'PENDING_ELEVATION_NOT_FOUND'
      | 'ACTIVE_ELEVATION_NOT_FOUND'
      | 'ELEVATION_EXPIRY_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'SupportElevationPolicyError';
  }
}

export class InMemorySupportElevationRepository {
  private readonly records = new Map<string, SupportElevationRecord>();

  async create(record: SupportElevationRecord): Promise<void> {
    this.records.set(record.id, cloneSupportElevationRecord(record));
  }

  async save(record: SupportElevationRecord): Promise<void> {
    this.records.set(record.id, cloneSupportElevationRecord(record));
  }

  async getById(id: string): Promise<SupportElevationRecord | null> {
    const record = this.records.get(id);
    return record ? cloneSupportElevationRecord(record) : null;
  }

  async findActive(input: {
    tenantId: string;
    officeId: string;
    supportUserId: string;
    now: string;
  }): Promise<SupportElevationRecord | null> {
    for (const record of this.records.values()) {
      if (
        record.tenantId === input.tenantId &&
        record.officeId === input.officeId &&
        record.supportUserId === input.supportUserId &&
        record.status === 'active' &&
        record.expiresAt !== undefined &&
        record.expiresAt > input.now
      ) {
        return cloneSupportElevationRecord(record);
      }
    }

    return null;
  }

  async findLatestBySupport(input: {
    tenantId: string;
    officeId: string;
    supportUserId: string;
  }): Promise<SupportElevationRecord | null> {
    const records = Array.from(this.records.values())
      .filter(
        (record) =>
          record.tenantId === input.tenantId &&
          record.officeId === input.officeId &&
          record.supportUserId === input.supportUserId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return records[0] ? cloneSupportElevationRecord(records[0]) : null;
  }
}

type SupportElevationRepository = Pick<
  InMemorySupportElevationRepository,
  'create' | 'save' | 'getById' | 'findActive' | 'findLatestBySupport'
>;

type TenancyRepository = Pick<
  InMemoryTenancyRepository,
  'findMembershipByTenantAndUser'
>;

type SupportAccessStatusInput = {
  tenantId: string;
  officeId: string;
  supportUserId: string;
};

export class SupportElevationService {
  constructor(
    private readonly repository: SupportElevationRepository,
    private readonly tenancyRepository: TenancyRepository,
    private readonly auditService: Pick<AuditEventService, 'writeEvent'>,
    private readonly clock: Clock = defaultClock,
  ) {}

  async requestElevation(
    input: RequestSupportElevationInput,
  ): Promise<SupportElevationRecord> {
    this.requireFutureExpiry(input.expiresAt);

    const record: SupportElevationRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      officeId: input.officeId,
      supportUserId: input.supportUserId,
      status: 'pending',
      contentAccess: 'denied',
      reason: input.reason,
      requestedBy: input.requestedBy,
      expiresAt: input.expiresAt,
      createdAt: this.clock.now().toISOString(),
    };

    await this.repository.create(record);
    await this.auditService.writeEvent({
      tenantId: record.tenantId,
      officeId: record.officeId,
      actorId: input.requestedBy,
      type: 'support.elevation_requested',
      metadata: {
        supportElevationId: record.id,
        supportUserId: record.supportUserId,
        reason: record.reason,
      },
    });

    return freezeSupportElevationRecord(record);
  }

  async approveElevation(
    input: ApproveSupportElevationInput,
  ): Promise<SupportElevationRecord> {
    const actor = await this.requireAdminMembership(
      input.tenantId,
      input.officeId,
      input.actorUserId,
    );
    const pending = await this.repository.getById(input.supportElevationId);
    if (
      !pending ||
      pending.tenantId !== input.tenantId ||
      pending.officeId !== input.officeId ||
      pending.status !== 'pending'
    ) {
      throw new SupportElevationPolicyError(
        'PENDING_ELEVATION_NOT_FOUND',
        'Pending support elevation does not exist for this office.',
      );
    }
    await this.requireNoActiveElevation({
      tenantId: input.tenantId,
      officeId: input.officeId,
      supportUserId: pending.supportUserId,
    });
    this.requireFutureExpiry(input.expiresAt);

    const active = toActiveElevation(pending, actor.userId, input.expiresAt, this.clock.now());
    await this.repository.save(active);
    await this.auditGranted(active, actor.userId);

    return freezeSupportElevationRecord(active);
  }

  async grantElevation(
    input: GrantSupportElevationInput,
  ): Promise<SupportElevationRecord> {
    const actor = await this.requireAdminMembership(
      input.tenantId,
      input.officeId,
      input.actorUserId,
    );
    await this.requireNoActiveElevation(input);
    this.requireFutureExpiry(input.expiresAt);

    const now = this.clock.now();
    const active: SupportElevationRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      officeId: input.officeId,
      supportUserId: input.supportUserId,
      status: 'active',
      contentAccess: 'elevated',
      reason: input.reason,
      grantedBy: actor.userId,
      grantedAt: now.toISOString(),
      expiresAt: input.expiresAt,
      createdAt: now.toISOString(),
    };

    await this.repository.create(active);
    await this.auditGranted(active, actor.userId);

    return freezeSupportElevationRecord(active);
  }

  async revokeElevation(
    input: RevokeSupportElevationInput,
  ): Promise<SupportElevationRecord> {
    const actor = await this.requireAdminMembership(
      input.tenantId,
      input.officeId,
      input.actorUserId,
    );
    const active = await this.repository.findActive({
      tenantId: input.tenantId,
      officeId: input.officeId,
      supportUserId: input.supportUserId,
      now: this.clock.now().toISOString(),
    });
    if (!active) {
      throw new SupportElevationPolicyError(
        'ACTIVE_ELEVATION_NOT_FOUND',
        'Active support elevation does not exist for this support user.',
      );
    }

    const revoked: SupportElevationRecord = {
      ...active,
      status: 'revoked',
      contentAccess: 'denied',
      revokedBy: actor.userId,
      revokedAt: this.clock.now().toISOString(),
      revocationReason: input.reason,
    };

    await this.repository.save(revoked);
    await this.auditService.writeEvent({
      tenantId: revoked.tenantId,
      officeId: revoked.officeId,
      actorId: actor.userId,
      type: 'support.elevation_revoked',
      metadata: {
        supportElevationId: revoked.id,
        supportUserId: revoked.supportUserId,
        reason: input.reason,
      },
    });

    return freezeSupportElevationRecord(revoked);
  }

  async getSupportAccessStatus(
    input: SupportAccessStatusInput,
  ): Promise<SupportElevationStatusView> {
    const active = await this.repository.findActive({
      ...input,
      now: this.clock.now().toISOString(),
    });
    if (active) {
      return freezeSupportElevationStatus(toStatusView(active));
    }

    const latest = await this.repository.findLatestBySupport(input);
    if (latest && latest.status !== 'active') {
      return freezeSupportElevationStatus(toStatusView(latest));
    }

    return freezeSupportElevationStatus({
      tenantId: input.tenantId,
      officeId: input.officeId,
      supportUserId: input.supportUserId,
      status: 'not_elevated',
      contentAccess: 'denied',
    });
  }

  async canAccessContent(input: SupportAccessStatusInput): Promise<boolean> {
    const status = await this.getSupportAccessStatus(input);
    return status.status === 'active' && status.contentAccess === 'elevated';
  }

  private async requireAdminMembership(
    tenantId: string,
    officeId: string,
    userId: string,
  ): Promise<Membership> {
    const membership =
      await this.tenancyRepository.findMembershipByTenantAndUser(
        tenantId,
        userId,
      );
    if (
      !membership ||
      membership.officeId !== officeId ||
      membership.status !== 'active' ||
      (membership.role !== 'principal' && membership.role !== 'office_admin')
    ) {
      throw new SupportElevationPolicyError(
        'ADMIN_ROLE_REQUIRED',
        'Support elevation requires an active principal or office admin.',
      );
    }

    return membership;
  }

  private async requireNoActiveElevation(input: {
    tenantId: string;
    officeId: string;
    supportUserId: string;
  }): Promise<void> {
    if (!input.supportUserId) {
      return;
    }

    const active = await this.repository.findActive({
      ...input,
      now: this.clock.now().toISOString(),
    });
    if (active) {
      throw new SupportElevationPolicyError(
        'ACTIVE_ELEVATION_EXISTS',
        'An active support elevation already exists for this support user.',
      );
    }
  }

  private async auditGranted(
    record: SupportElevationRecord,
    actorUserId: string,
  ): Promise<void> {
    await this.auditService.writeEvent({
      tenantId: record.tenantId,
      officeId: record.officeId,
      actorId: actorUserId,
      type: 'support.elevation_granted',
      metadata: {
        supportElevationId: record.id,
        supportUserId: record.supportUserId,
        expiresAt: record.expiresAt ?? '',
        reason: record.reason,
      },
    });
  }

  private requireFutureExpiry(expiresAt: string): void {
    if (expiresAt <= this.clock.now().toISOString()) {
      throw new SupportElevationPolicyError(
        'ELEVATION_EXPIRY_REQUIRED',
        'Support elevation requires a future expiration timestamp.',
      );
    }
  }
}

function toActiveElevation(
  pending: SupportElevationRecord,
  grantedBy: string,
  expiresAt: string,
  grantedAt: Date,
): SupportElevationRecord {
  return {
    ...pending,
    status: 'active',
    contentAccess: 'elevated',
    grantedBy,
    grantedAt: grantedAt.toISOString(),
    expiresAt,
  };
}

function toStatusView(
  record: SupportElevationRecord,
): SupportElevationStatusView {
  const base = {
    tenantId: record.tenantId,
    officeId: record.officeId,
    supportUserId: record.supportUserId,
    status: record.status,
    contentAccess: record.contentAccess,
    reason: record.reason,
  };

  return {
    ...base,
    ...(record.requestedBy === undefined
      ? {}
      : { requestedBy: record.requestedBy }),
    ...(record.grantedBy === undefined ? {} : { grantedBy: record.grantedBy }),
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    ...(record.revokedBy === undefined ? {} : { revokedBy: record.revokedBy }),
  };
}

function cloneSupportElevationRecord(
  record: SupportElevationRecord,
): SupportElevationRecord {
  return structuredClone(record);
}

function freezeSupportElevationRecord(
  record: SupportElevationRecord,
): SupportElevationRecord {
  return Object.freeze(cloneSupportElevationRecord(record));
}

function freezeSupportElevationStatus(
  status: SupportElevationStatusView,
): SupportElevationStatusView {
  return Object.freeze(structuredClone(status));
}
