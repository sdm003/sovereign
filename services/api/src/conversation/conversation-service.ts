import { randomUUID } from 'node:crypto';

import type {
  Conversation,
  ConversationParticipant,
  ConversationResponse,
  ConversationTier,
  CreateConversationRequest,
  Membership,
} from '@sovereign/contracts';

import { InMemoryTenancyRepository, TenancyNotFoundError } from '../tenancy';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

type CreateConversationRecord = Conversation;

export class ConversationPolicyError extends Error {
  constructor(
    public readonly code:
      | 'PERSONAL_SINGLE_OWNER_ONLY'
      | 'RESTRICTED_CREATOR_NOT_ALLOWED'
      | 'RESTRICTED_PARTICIPANT_NOT_ALLOWED'
      | 'INACTIVE_PARTICIPANT_NOT_ALLOWED'
      | 'PARTICIPANT_NOT_FOUND'
      | 'CONVERSATION_NOT_FOUND'
      | 'CONVERSATION_ACCESS_DENIED'
      | 'PERSONAL_PARTICIPANTS_IMMUTABLE',
    message: string,
  ) {
    super(message);
    this.name = 'ConversationPolicyError';
  }
}

export class InMemoryConversationRepository {
  private readonly conversations = new Map<string, Conversation>();
  private readonly participants = new Map<string, ConversationParticipant[]>();

  async createConversation(conversation: CreateConversationRecord): Promise<void> {
    this.conversations.set(conversation.id, conversation);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async listConversationsByTenant(tenantId: string): Promise<Conversation[]> {
    return Array.from(this.conversations.values()).filter(
      (conversation) => conversation.tenantId === tenantId,
    );
  }

  async saveParticipants(
    conversationId: string,
    participants: ConversationParticipant[],
  ): Promise<void> {
    this.participants.set(conversationId, participants);
  }

  async getParticipants(
    conversationId: string,
  ): Promise<ConversationParticipant[]> {
    return (this.participants.get(conversationId) ?? []).map((participant) => ({
      ...participant,
    }));
  }
}

type TenancyRepository = Pick<
  InMemoryTenancyRepository,
  'findMembershipByTenantAndUser'
>;

type ConversationRepository = Pick<
  InMemoryConversationRepository,
  | 'createConversation'
  | 'getConversation'
  | 'listConversationsByTenant'
  | 'saveParticipants'
  | 'getParticipants'
>;

type RestrictedAccessGuard = {
  assertRestrictedAccess: (input: {
    tenantId: string;
    officeId: string;
    userId: string;
    conversationTier: Conversation['tier'];
  }) => Promise<void>;
};

type ListInput = {
  tenantId: string;
  userId: string;
};

type GetInput = ListInput & {
  conversationId: string;
};

type ParticipantMutationInput = {
  tenantId: string;
  actorUserId: string;
  conversationId: string;
  participantUserId: string;
};

export class ConversationService {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly tenancyRepository: TenancyRepository,
    private readonly restrictedAccessGuard: RestrictedAccessGuard = {
      assertRestrictedAccess: async () => undefined,
    },
    private readonly clock: Clock = defaultClock,
  ) {}

  async createConversation(
    input: CreateConversationRequest,
  ): Promise<ConversationResponse> {
    const actor = await this.requireActiveMembership(
      input.tenantId,
      input.actorUserId,
    );

    const requestedIds = uniqueIds([input.actorUserId, ...input.participantIds]);

    if (input.tier === 'personal' && requestedIds.length !== 1) {
      throw new ConversationPolicyError(
        'PERSONAL_SINGLE_OWNER_ONLY',
        'Personal conversations must remain single-owner only in V1.',
      );
    }

    if (input.tier === 'restricted' && !isRestrictedEligible(actor)) {
      throw new ConversationPolicyError(
        'RESTRICTED_CREATOR_NOT_ALLOWED',
        'Only restricted-eligible memberships may create restricted conversations.',
      );
    }

    const memberships = await Promise.all(
      requestedIds.map((userId) =>
        this.requireActiveMembership(input.tenantId, userId),
      ),
    );

    if (input.tier === 'restricted') {
      for (const membership of memberships) {
        if (!isRestrictedEligible(membership)) {
          throw new ConversationPolicyError(
            'RESTRICTED_PARTICIPANT_NOT_ALLOWED',
            'Restricted conversations may only include restricted-eligible memberships.',
          );
        }
      }
    }

    const conversation: Conversation = {
      id: randomUUID(),
      tenantId: input.tenantId,
      officeId: actor.officeId,
      tier: input.tier,
      createdBy: input.actorUserId,
      createdAt: this.clock.now().toISOString(),
    };
    await this.repository.createConversation(conversation);

    const participants = memberships.map((membership) => ({
      id: randomUUID(),
      conversationId: conversation.id,
      userId: membership.userId,
      role: membership.role,
      createdAt: this.clock.now().toISOString(),
    }));
    await this.repository.saveParticipants(conversation.id, participants);

    return this.toResponse(conversation, participants);
  }

  async listConversations(input: ListInput): Promise<ConversationResponse[]> {
    const conversations = await this.repository.listConversationsByTenant(
      input.tenantId,
    );
    const visible: ConversationResponse[] = [];

    for (const conversation of conversations) {
      const participants = await this.repository.getParticipants(conversation.id);
      if (participants.some((participant) => participant.userId === input.userId)) {
        if (conversation.tier === 'restricted') {
          try {
            await this.restrictedAccessGuard.assertRestrictedAccess({
              tenantId: conversation.tenantId,
              officeId: conversation.officeId,
              userId: input.userId,
              conversationTier: conversation.tier,
            });
          } catch {
            continue;
          }
        }
        visible.push(this.toResponse(conversation, participants));
      }
    }

    return visible;
  }

  async getConversation(input: GetInput): Promise<ConversationResponse> {
    const conversation = await this.requireConversation(input.conversationId);
    if (conversation.tenantId !== input.tenantId) {
      throw new ConversationPolicyError(
        'CONVERSATION_ACCESS_DENIED',
        'Conversation access is tenant-scoped.',
      );
    }

    const participants = await this.repository.getParticipants(conversation.id);
    if (!participants.some((participant) => participant.userId === input.userId)) {
      throw new ConversationPolicyError(
        'CONVERSATION_ACCESS_DENIED',
        'User is not a participant in this conversation.',
      );
    }

    await this.restrictedAccessGuard.assertRestrictedAccess({
      tenantId: conversation.tenantId,
      officeId: conversation.officeId,
      userId: input.userId,
      conversationTier: conversation.tier,
    });

    return this.toResponse(conversation, participants);
  }

  async addParticipant(
    input: ParticipantMutationInput,
  ): Promise<ConversationResponse> {
    const conversation = await this.requireConversation(input.conversationId);
    if (conversation.tier === 'personal') {
      throw new ConversationPolicyError(
        'PERSONAL_PARTICIPANTS_IMMUTABLE',
        'Personal conversations may not add participants.',
      );
    }

    await this.assertActorParticipant(input);
    await this.restrictedAccessGuard.assertRestrictedAccess({
      tenantId: conversation.tenantId,
      officeId: conversation.officeId,
      userId: input.actorUserId,
      conversationTier: conversation.tier,
    });
    const participants = await this.repository.getParticipants(conversation.id);
    if (participants.some((participant) => participant.userId === input.participantUserId)) {
      return this.toResponse(conversation, participants);
    }

    const membership = await this.requireActiveMembership(
      input.tenantId,
      input.participantUserId,
    );

    if (conversation.tier === 'restricted' && !isRestrictedEligible(membership)) {
      throw new ConversationPolicyError(
        'RESTRICTED_PARTICIPANT_NOT_ALLOWED',
        'Restricted conversations may only include restricted-eligible memberships.',
      );
    }

    const nextParticipants = [
      ...participants,
      {
        id: randomUUID(),
        conversationId: conversation.id,
        userId: membership.userId,
        role: membership.role,
        createdAt: this.clock.now().toISOString(),
      },
    ];
    await this.repository.saveParticipants(conversation.id, nextParticipants);
    return this.toResponse(conversation, nextParticipants);
  }

  async removeParticipant(
    input: ParticipantMutationInput,
  ): Promise<ConversationResponse> {
    const conversation = await this.requireConversation(input.conversationId);
    if (conversation.tier === 'personal') {
      throw new ConversationPolicyError(
        'PERSONAL_PARTICIPANTS_IMMUTABLE',
        'Personal conversations may not remove participants.',
      );
    }

    await this.assertActorParticipant(input);
    await this.restrictedAccessGuard.assertRestrictedAccess({
      tenantId: conversation.tenantId,
      officeId: conversation.officeId,
      userId: input.actorUserId,
      conversationTier: conversation.tier,
    });
    const participants = await this.repository.getParticipants(conversation.id);
    const nextParticipants = participants.filter(
      (participant) => participant.userId !== input.participantUserId,
    );
    await this.repository.saveParticipants(conversation.id, nextParticipants);
    return this.toResponse(conversation, nextParticipants);
  }

  private async requireConversation(id: string): Promise<Conversation> {
    const conversation = await this.repository.getConversation(id);
    if (!conversation) {
      throw new ConversationPolicyError(
        'CONVERSATION_NOT_FOUND',
        'Conversation does not exist.',
      );
    }
    return conversation;
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
      throw new ConversationPolicyError(
        'PARTICIPANT_NOT_FOUND',
        'Participant membership does not exist for this tenant.',
      );
    }

    if (membership.status !== 'active') {
      throw new ConversationPolicyError(
        'INACTIVE_PARTICIPANT_NOT_ALLOWED',
        'Only active memberships may participate in conversations.',
      );
    }

    return membership;
  }

  private async assertActorParticipant(
    input: ParticipantMutationInput,
  ): Promise<void> {
    const conversation = await this.requireConversation(input.conversationId);
    if (conversation.tenantId !== input.tenantId) {
      throw new ConversationPolicyError(
        'CONVERSATION_ACCESS_DENIED',
        'Conversation access is tenant-scoped.',
      );
    }

    const participants = await this.repository.getParticipants(conversation.id);
    if (!participants.some((participant) => participant.userId === input.actorUserId)) {
      throw new ConversationPolicyError(
        'CONVERSATION_ACCESS_DENIED',
        'Only existing participants may manage conversation membership in this slice.',
      );
    }
  }

  private toResponse(
    conversation: Conversation,
    participants: ConversationParticipant[],
  ): ConversationResponse {
    return {
      id: conversation.id,
      tenantId: conversation.tenantId,
      officeId: conversation.officeId,
      tier: conversation.tier,
      createdBy: conversation.createdBy,
      participantIds: participants.map((participant) => participant.userId),
    };
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function isRestrictedEligible(membership: Membership): boolean {
  return (
    membership.role === 'principal' ||
    membership.role === 'office_admin' ||
    membership.role === 'restricted_member'
  );
}
