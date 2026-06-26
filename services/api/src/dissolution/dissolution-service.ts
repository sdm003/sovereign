import { randomUUID } from 'node:crypto';

import type {
  ConfirmDissolutionInput,
  DissolutionRequestRecord,
  DissolutionTransitionRequest,
  RejectDissolutionInput,
  RequestDissolutionInput,
} from '@sovereign/contracts';

import { AuditEventService } from '../audit';
import {
  ConversationPolicyError,
  ConversationService,
  InMemoryConversationRepository,
} from '../conversation';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

type ConversationParticipantReader = Pick<
  InMemoryConversationRepository,
  'getParticipants'
>;

type TimelinePublisher = {
  publishTimelineEvent: (input: {
    tenantId: string;
    conversationId: string;
    eventId: string;
  }) => Promise<unknown>;
};

const noopTimelinePublisher: TimelinePublisher = {
  publishTimelineEvent: async () => [],
};

export class DissolutionWorkflowError extends Error {
  constructor(
    public readonly code:
      | 'CONVERSATION_ACCESS_DENIED'
      | 'CONVERSATION_NOT_ELIGIBLE'
      | 'PENDING_REQUEST_EXISTS'
      | 'PENDING_REQUEST_NOT_FOUND'
      | 'UNILATERAL_CONFIRMATION_DENIED'
      | 'INVALID_TRANSITION',
    message: string,
  ) {
    super(message);
    this.name = 'DissolutionWorkflowError';
  }
}

export class InMemoryDissolutionRepository {
  private readonly records = new Map<string, DissolutionRequestRecord>();

  async create(record: DissolutionRequestRecord): Promise<void> {
    this.records.set(record.id, cloneDissolutionRecord(record));
  }

  async save(record: DissolutionRequestRecord): Promise<void> {
    this.records.set(record.id, cloneDissolutionRecord(record));
  }

  async findPendingByConversation(input: {
    tenantId: string;
    conversationId: string;
  }): Promise<DissolutionRequestRecord | null> {
    for (const record of this.records.values()) {
      if (
        record.tenantId === input.tenantId &&
        record.conversationId === input.conversationId &&
        record.status === 'pending_confirmation'
      ) {
        return cloneDissolutionRecord(record);
      }
    }

    return null;
  }

  async listByConversation(input: {
    tenantId: string;
    conversationId: string;
  }): Promise<DissolutionRequestRecord[]> {
    return Array.from(this.records.values())
      .filter(
        (record) =>
          record.tenantId === input.tenantId &&
          record.conversationId === input.conversationId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((record) => cloneDissolutionRecord(record));
  }
}

type DissolutionRepository = Pick<
  InMemoryDissolutionRepository,
  'create' | 'save' | 'findPendingByConversation' | 'listByConversation'
>;

export class DissolutionWorkflowService {
  constructor(
    private readonly repository: DissolutionRepository,
    private readonly conversationService: ConversationService,
    private readonly participantReader: ConversationParticipantReader,
    private readonly auditService: Pick<AuditEventService, 'writeEvent'>,
    private readonly timelinePublisher: TimelinePublisher = noopTimelinePublisher,
    private readonly clock: Clock = defaultClock,
  ) {}

  async transitionDissolution(
    input: DissolutionTransitionRequest,
  ): Promise<DissolutionRequestRecord> {
    switch (input.action) {
      case 'request':
        return this.requestDissolution(input);
      case 'confirm':
        return this.confirmDissolution(input);
      case 'reject':
        return this.rejectDissolution(input);
      default:
        throw new DissolutionWorkflowError(
          'INVALID_TRANSITION',
          'Unsupported dissolution transition.',
        );
    }
  }

  async requestDissolution(
    input: RequestDissolutionInput,
  ): Promise<DissolutionRequestRecord> {
    const conversation = await this.requireEligibleConversation(input);
    const existing = await this.repository.findPendingByConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });

    if (existing) {
      throw new DissolutionWorkflowError(
        'PENDING_REQUEST_EXISTS',
        'A pending dissolution request already exists for this conversation.',
      );
    }

    const record: DissolutionRequestRecord = {
      id: randomUUID(),
      tenantId: conversation.tenantId,
      officeId: conversation.officeId,
      conversationId: conversation.id,
      status: 'pending_confirmation',
      requestedBy: input.actorUserId,
      createdAt: this.clock.now().toISOString(),
    };

    await this.repository.create(record);
    await this.auditService.writeEvent({
      tenantId: record.tenantId,
      officeId: record.officeId,
      actorId: input.actorUserId,
      type: 'dissolution.requested',
      metadata: {
        dissolutionRequestId: record.id,
        conversationId: record.conversationId,
        status: record.status,
      },
    });
    await this.publishTimeline(record, 'requested');

    return freezeDissolutionRecord(record);
  }

  async confirmDissolution(
    input: ConfirmDissolutionInput,
  ): Promise<DissolutionRequestRecord> {
    await this.requireEligibleConversation(input);
    const record = await this.requirePendingRequest(input);

    if (record.requestedBy === input.actorUserId) {
      throw new DissolutionWorkflowError(
        'UNILATERAL_CONFIRMATION_DENIED',
        'Dissolution requires confirmation by another authorized participant.',
      );
    }

    const resolved = {
      ...record,
      status: 'completed' as const,
      confirmedBy: input.actorUserId,
      resolvedAt: this.clock.now().toISOString(),
    };
    await this.repository.save(resolved);
    await this.auditResolved(resolved, input.actorUserId, 'completed');
    await this.publishTimeline(resolved, 'completed');

    return freezeDissolutionRecord(resolved);
  }

  async rejectDissolution(
    input: RejectDissolutionInput,
  ): Promise<DissolutionRequestRecord> {
    await this.requireEligibleConversation(input);
    const record = await this.requirePendingRequest(input);
    const resolved =
      input.reason === undefined
        ? {
            ...record,
            status: 'rejected' as const,
            rejectedBy: input.actorUserId,
            resolvedAt: this.clock.now().toISOString(),
          }
        : {
            ...record,
            status: 'rejected' as const,
            rejectedBy: input.actorUserId,
            rejectionReason: input.reason,
            resolvedAt: this.clock.now().toISOString(),
          };

    await this.repository.save(resolved);
    await this.auditResolved(resolved, input.actorUserId, 'rejected');
    await this.publishTimeline(resolved, 'rejected');

    return freezeDissolutionRecord(resolved);
  }

  async listDissolutionRequests(input: {
    tenantId: string;
    actorUserId: string;
    conversationId: string;
  }): Promise<DissolutionRequestRecord[]> {
    await this.requireConversationAccess(input);
    const records = await this.repository.listByConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });

    return records.map((record) => freezeDissolutionRecord(record));
  }

  private async requireEligibleConversation(input: {
    tenantId: string;
    actorUserId: string;
    conversationId: string;
  }) {
    const conversation = await this.requireConversationAccess(input);
    const participants = await this.participantReader.getParticipants(
      input.conversationId,
    );
    if (conversation.tier === 'personal' || participants.length < 2) {
      throw new DissolutionWorkflowError(
        'CONVERSATION_NOT_ELIGIBLE',
        'Bilateral dissolution requires a governed conversation with at least two participants.',
      );
    }

    return conversation;
  }

  private async requireConversationAccess(input: {
    tenantId: string;
    actorUserId: string;
    conversationId: string;
  }) {
    try {
      return await this.conversationService.getConversation({
        tenantId: input.tenantId,
        userId: input.actorUserId,
        conversationId: input.conversationId,
      });
    } catch (error: unknown) {
      if (error instanceof ConversationPolicyError) {
        throw new DissolutionWorkflowError(
          'CONVERSATION_ACCESS_DENIED',
          'Only authorized participants may transition dissolution state.',
        );
      }
      throw error;
    }
  }

  private async requirePendingRequest(input: {
    tenantId: string;
    conversationId: string;
  }): Promise<DissolutionRequestRecord> {
    const record = await this.repository.findPendingByConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });
    if (!record) {
      throw new DissolutionWorkflowError(
        'PENDING_REQUEST_NOT_FOUND',
        'A pending dissolution request is required for this transition.',
      );
    }

    return record;
  }

  private async auditResolved(
    record: DissolutionRequestRecord,
    actorId: string,
    outcome: 'completed' | 'rejected',
  ): Promise<void> {
    await this.auditService.writeEvent({
      tenantId: record.tenantId,
      officeId: record.officeId,
      actorId,
      type: 'dissolution.resolved',
      metadata:
        record.rejectionReason === undefined
          ? {
              dissolutionRequestId: record.id,
              conversationId: record.conversationId,
              outcome,
              requestedBy: record.requestedBy,
            }
          : {
              dissolutionRequestId: record.id,
              conversationId: record.conversationId,
              outcome,
              requestedBy: record.requestedBy,
              reason: record.rejectionReason,
            },
    });
  }

  private async publishTimeline(
    record: DissolutionRequestRecord,
    action: 'requested' | 'completed' | 'rejected',
  ): Promise<void> {
    await this.timelinePublisher.publishTimelineEvent({
      tenantId: record.tenantId,
      conversationId: record.conversationId,
      eventId: `dissolution.${record.id}.${action}`,
    });
  }
}

function cloneDissolutionRecord(
  record: DissolutionRequestRecord,
): DissolutionRequestRecord {
  return { ...record };
}

function freezeDissolutionRecord(
  record: DissolutionRequestRecord,
): DissolutionRequestRecord {
  return Object.freeze(cloneDissolutionRecord(record));
}
