import type {
  AuditEvent,
  AuditEventMetadata,
  AuditEventMetadataValue,
  AuditQueryParams,
  AuditReviewDetail,
  AuditReviewListItem,
  AuthRole,
  Membership,
} from '@sovereign/contracts';

import type {
  InMemoryAuditEventRepository,
} from './audit-service';
import type { InMemoryTenancyRepository } from '../tenancy';

type AuditRepository = Pick<InMemoryAuditEventRepository, 'listByTenant'>;

type TenancyRepository = Pick<
  InMemoryTenancyRepository,
  'findMembershipByTenantAndUser'
>;

type QueryEventsInput = {
  tenantId: string;
  actorUserId: string;
  filters: AuditQueryParams;
};

type GetEventDetailInput = {
  tenantId: string;
  actorUserId: string;
  eventId: string;
};

export type AuditReviewQueryResult = {
  filters: AuditQueryParams;
  items: AuditReviewListItem[];
};

export const auditReviewRouteManifest = [
  {
    method: 'GET',
    path: '/admin/audit/events',
    description: 'List audit events with actor, conversation, type, and date filters.',
  },
  {
    method: 'GET',
    path: '/admin/audit/events/:eventId',
    description: 'Inspect one audit event and its metadata.',
  },
] as const;

export class AuditReviewAccessError extends Error {
  constructor(
    public readonly code: 'ACTIVE_ADMIN_REQUIRED' | 'ADMIN_ROLE_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'AuditReviewAccessError';
  }
}

export class AuditReviewNotFoundError extends Error {
  constructor(
    public readonly code: 'AUDIT_EVENT_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'AuditReviewNotFoundError';
  }
}

export class AdminAuditReviewService {
  constructor(
    private readonly auditRepository: AuditRepository,
    private readonly tenancyRepository: TenancyRepository,
  ) {}

  async queryEvents(input: QueryEventsInput): Promise<AuditReviewQueryResult> {
    await this.requireAuditReviewer(input.tenantId, input.actorUserId);

    const events = await this.auditRepository.listByTenant(input.tenantId);
    const items = events
      .filter((event) => matchesAuditFilters(event, input.filters))
      .map(toAuditReviewListItem);

    return {
      filters: cloneAuditQueryParams(input.filters),
      items,
    };
  }

  async getEventDetail(input: GetEventDetailInput): Promise<AuditReviewDetail> {
    await this.requireAuditReviewer(input.tenantId, input.actorUserId);

    const events = await this.auditRepository.listByTenant(input.tenantId);
    const event = events.find((candidate) => candidate.id === input.eventId);

    if (!event) {
      throw new AuditReviewNotFoundError(
        'AUDIT_EVENT_NOT_FOUND',
        'Audit event does not exist for this tenant.',
      );
    }

    return Object.freeze({
      ...toAuditReviewListItem(event),
      metadata: deepFreeze(structuredClone(event.metadata)),
    });
  }

  private async requireAuditReviewer(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership =
      await this.tenancyRepository.findMembershipByTenantAndUser(
        tenantId,
        userId,
      );

    if (!membership || membership.status !== 'active') {
      throw new AuditReviewAccessError(
        'ACTIVE_ADMIN_REQUIRED',
        'Audit review requires an active tenant membership.',
      );
    }

    if (!isAuditReviewerRole(membership.role)) {
      throw new AuditReviewAccessError(
        'ADMIN_ROLE_REQUIRED',
        'Audit review is restricted to principal or office_admin actors.',
      );
    }

    return membership;
  }
}

function matchesAuditFilters(
  event: AuditEvent,
  filters: AuditQueryParams,
): boolean {
  if (filters.actorId && event.actorId !== filters.actorId) {
    return false;
  }

  if (filters.type && event.type !== filters.type) {
    return false;
  }

  if (
    filters.conversationId &&
    getMetadataString(event.metadata, 'conversationId') !== filters.conversationId
  ) {
    return false;
  }

  if (filters.from && event.occurredAt < filters.from) {
    return false;
  }

  if (filters.to && event.occurredAt > filters.to) {
    return false;
  }

  return true;
}

function toAuditReviewListItem(event: AuditEvent): AuditReviewListItem {
  const conversationId = getMetadataString(event.metadata, 'conversationId');
  const item: AuditReviewListItem = {
    id: event.id,
    tenantId: event.tenantId,
    officeId: event.officeId,
    type: event.type,
    occurredAt: event.occurredAt,
  };

  if (event.actorId !== undefined) {
    item.actorId = event.actorId;
  }

  if (conversationId !== undefined) {
    item.conversationId = conversationId;
  }

  return Object.freeze(item);
}

function getMetadataString(
  metadata: AuditEventMetadata,
  key: string,
): string | undefined {
  const value = metadata[key];

  return typeof value === 'string' ? value : undefined;
}

function cloneAuditQueryParams(filters: AuditQueryParams): AuditQueryParams {
  return { ...filters };
}

function isAuditReviewerRole(role: AuthRole): boolean {
  return role === 'principal' || role === 'office_admin';
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const nestedValue of Object.values(
      value as Record<string, AuditEventMetadataValue>,
    )) {
      deepFreeze(nestedValue);
    }
  }

  return value;
}
