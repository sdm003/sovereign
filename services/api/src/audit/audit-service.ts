import { randomUUID } from 'node:crypto';

import {
  auditEventTypes,
  type AuditEvent,
  type AuditEventMetadata,
  type AuditEventMetadataValue,
  type AuditEventType,
  type WriteAuditEventInput,
} from '@sovereign/contracts';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

const auditEventTypeSet = new Set<string>(auditEventTypes);

export class AuditEventConstraintError extends Error {
  constructor(
    public readonly code:
      | 'UNSUPPORTED_AUDIT_EVENT_TYPE'
      | 'DUPLICATE_AUDIT_EVENT',
    message: string,
  ) {
    super(message);
    this.name = 'AuditEventConstraintError';
  }
}

export class InMemoryAuditEventRepository {
  private readonly events = new Map<string, AuditEvent>();

  async append(event: AuditEvent): Promise<void> {
    if (this.events.has(event.id)) {
      throw new AuditEventConstraintError(
        'DUPLICATE_AUDIT_EVENT',
        'Audit events are append-only and cannot be overwritten.',
      );
    }

    this.events.set(event.id, cloneAuditEvent(event));
  }

  async listByTenant(tenantId: string): Promise<AuditEvent[]> {
    return Array.from(this.events.values())
      .filter((event) => event.tenantId === tenantId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .map((event) => freezeAuditEvent(cloneAuditEvent(event)));
  }
}

type AuditEventRepository = Pick<
  InMemoryAuditEventRepository,
  'append' | 'listByTenant'
>;

export class AuditEventService {
  constructor(
    private readonly repository: AuditEventRepository,
    private readonly clock: Clock = defaultClock,
  ) {}

  async writeEvent(input: WriteAuditEventInput): Promise<AuditEvent> {
    if (!isAuditEventType(input.type)) {
      throw new AuditEventConstraintError(
        'UNSUPPORTED_AUDIT_EVENT_TYPE',
        `Unsupported audit event type: ${input.type}`,
      );
    }

    const metadata = cloneAuditEventMetadata(input.metadata);
    const occurredAt = this.clock.now().toISOString();
    const event =
      input.actorId === undefined
        ? {
            id: randomUUID(),
            tenantId: input.tenantId,
            officeId: input.officeId,
            type: input.type,
            metadata,
            occurredAt,
          }
        : {
            id: randomUUID(),
            tenantId: input.tenantId,
            officeId: input.officeId,
            actorId: input.actorId,
            type: input.type,
            metadata,
            occurredAt,
          };

    await this.repository.append(event);

    return freezeAuditEvent(cloneAuditEvent(event));
  }

  async listTenantEvents(tenantId: string): Promise<AuditEvent[]> {
    return this.repository.listByTenant(tenantId);
  }
}

function isAuditEventType(type: string): type is AuditEventType {
  return auditEventTypeSet.has(type);
}

function cloneAuditEvent(event: AuditEvent): AuditEvent {
  const metadata = cloneAuditEventMetadata(event.metadata);

  return event.actorId === undefined
    ? {
        id: event.id,
        tenantId: event.tenantId,
        officeId: event.officeId,
        type: event.type,
        metadata,
        occurredAt: event.occurredAt,
      }
    : {
        id: event.id,
        tenantId: event.tenantId,
        officeId: event.officeId,
        actorId: event.actorId,
        type: event.type,
        metadata,
        occurredAt: event.occurredAt,
      };
}

function cloneAuditEventMetadata(
  metadata: AuditEventMetadata,
): AuditEventMetadata {
  return structuredClone(metadata);
}

function freezeAuditEvent(event: AuditEvent): AuditEvent {
  return deepFreeze(event);
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
