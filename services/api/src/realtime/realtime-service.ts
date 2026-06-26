import { randomUUID } from 'node:crypto';

import type {
  ConversationResponse,
  RealtimeStateSync,
  RestrictedSessionStatus,
  ThreadRealtimeEvent,
} from '@sovereign/contracts';

import { ConversationPolicyError, ConversationService } from '../conversation';

type SubscribeInput = {
  tenantId: string;
  officeId: string;
  userId: string;
  conversationId: string;
  connectionId: string;
};

type PublishInput = {
  tenantId: string;
  conversationId: string;
};

type PublishMessageInput = PublishInput & {
  messageId: string;
};

type PublishTimelineInput = PublishInput & {
  eventId: string;
};

type Delivery = {
  connectionId: string;
  event: ThreadRealtimeEvent;
};

type RealtimeSubscription = {
  id: string;
  tenantId: string;
  officeId: string;
  userId: string;
  conversationId: string;
  connectionId: string;
  createdAt: string;
};

type RestrictedSessionReader = {
  getRestrictedSessionStatus: (input: {
    tenantId: string;
    userId: string;
  }) => Promise<RestrictedSessionStatus>;
};

export class RealtimeDeliveryError extends Error {
  constructor(
    public readonly code: 'SUBSCRIPTION_DENIED',
    message: string,
  ) {
    super(message);
    this.name = 'RealtimeDeliveryError';
  }
}

export class InMemoryRealtimeSubscriptionRepository {
  private readonly subscriptions = new Map<string, RealtimeSubscription>();

  async create(subscription: RealtimeSubscription): Promise<void> {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  async listByConversation(conversationId: string): Promise<RealtimeSubscription[]> {
    return Array.from(this.subscriptions.values())
      .filter((subscription) => subscription.conversationId === conversationId)
      .map((subscription) => ({ ...subscription }));
  }

  async listByConnection(connectionId: string): Promise<RealtimeSubscription[]> {
    return Array.from(this.subscriptions.values())
      .filter((subscription) => subscription.connectionId === connectionId)
      .map((subscription) => ({ ...subscription }));
  }

  async deleteByTenantAndUser(tenantId: string, userId: string): Promise<number> {
    let deletedCount = 0;

    for (const [id, subscription] of this.subscriptions.entries()) {
      if (subscription.tenantId === tenantId && subscription.userId === userId) {
        this.subscriptions.delete(id);
        deletedCount += 1;
      }
    }

    return deletedCount;
  }
}

type SubscriptionRepository = Pick<
  InMemoryRealtimeSubscriptionRepository,
  'create' | 'listByConversation' | 'listByConnection' | 'deleteByTenantAndUser'
>;

export class RealtimeGatewayService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly conversationService: ConversationService,
    private readonly restrictedSessionReader: RestrictedSessionReader,
  ) {}

  async subscribe(
    input: SubscribeInput,
  ): Promise<{ allowed: true; conversationId: string; connectionId: string }> {
    try {
      const conversation = await this.conversationService.getConversation({
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId: input.conversationId,
      });

      await this.assertOffice(conversation, input.officeId);
      await this.assertRestrictedRealtimeEligibility(conversation, input);
    } catch (error: unknown) {
      if (
        error instanceof ConversationPolicyError ||
        error instanceof RealtimeDeliveryError
      ) {
        throw new RealtimeDeliveryError(
          'SUBSCRIPTION_DENIED',
          'Realtime subscription denied for this conversation.',
        );
      }
      throw error;
    }

    await this.repository.create({
      id: randomUUID(),
      tenantId: input.tenantId,
      officeId: input.officeId,
      userId: input.userId,
      conversationId: input.conversationId,
      connectionId: input.connectionId,
      createdAt: new Date().toISOString(),
    });

    return {
      allowed: true,
      conversationId: input.conversationId,
      connectionId: input.connectionId,
    };
  }

  async publishMessageCreated(input: PublishMessageInput): Promise<Delivery[]> {
    return this.publish(input.conversationId, {
      type: 'message.created',
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
  }

  async publishTimelineEvent(input: PublishTimelineInput): Promise<Delivery[]> {
    return this.publish(input.conversationId, {
      type: 'timeline.event',
      conversationId: input.conversationId,
      eventId: input.eventId,
    });
  }

  async getStateSync(input: {
    tenantId: string;
    officeId: string;
    userId: string;
    connectionId: string;
  }): Promise<RealtimeStateSync> {
    const subscriptions = await this.repository.listByConnection(input.connectionId);
    const subscribedConversationIds: string[] = [];

    for (const subscription of subscriptions) {
      try {
        const conversation = await this.conversationService.getConversation({
          tenantId: input.tenantId,
          userId: input.userId,
          conversationId: subscription.conversationId,
        });

        await this.assertOffice(conversation, input.officeId);
        await this.assertRestrictedRealtimeEligibility(conversation, {
          tenantId: input.tenantId,
          officeId: input.officeId,
          userId: input.userId,
          conversationId: subscription.conversationId,
          connectionId: input.connectionId,
        });
        subscribedConversationIds.push(subscription.conversationId);
      } catch {
        continue;
      }
    }

    return {
      connectionId: input.connectionId,
      subscribedConversationIds,
    };
  }

  async invalidateUserSubscriptions(input: {
    tenantId: string;
    userId: string;
  }): Promise<number> {
    return this.repository.deleteByTenantAndUser(input.tenantId, input.userId);
  }

  private async publish(
    conversationId: string,
    event: ThreadRealtimeEvent,
  ): Promise<Delivery[]> {
    const subscriptions = await this.repository.listByConversation(conversationId);
    return subscriptions.map((subscription) => ({
      connectionId: subscription.connectionId,
      event,
    }));
  }

  private async assertOffice(
    conversation: ConversationResponse,
    officeId: string,
  ): Promise<void> {
    if (conversation.officeId !== officeId) {
      throw new RealtimeDeliveryError(
        'SUBSCRIPTION_DENIED',
        'Realtime subscription denied outside the conversation office.',
      );
    }
  }

  private async assertRestrictedRealtimeEligibility(
    conversation: ConversationResponse,
    input: SubscribeInput,
  ): Promise<void> {
    if (conversation.tier !== 'restricted') {
      return;
    }

    const status = await this.restrictedSessionReader.getRestrictedSessionStatus({
      tenantId: input.tenantId,
      userId: input.userId,
    });
    if (!status.active) {
      throw new RealtimeDeliveryError(
        'SUBSCRIPTION_DENIED',
        'Restricted realtime subscription requires an active restricted session.',
      );
    }
  }
}
