import { randomUUID } from 'node:crypto';

import type {
  AuthRole,
  Conversation,
  CreateGuestIdentityRequest,
  GrantGuestScopeRequest,
  GuestDirectoryEntry,
  GuestIdentity,
  GuestScope,
  KillGuestAccessRequest,
  KillGuestAccessResult,
  Membership,
  RevokeGuestScopeRequest,
} from '@sovereign/contracts';

import type { AuditEventService } from '../audit';
import type { InMemoryConversationRepository } from '../conversation';
import type { InMemoryTenancyRepository } from '../tenancy';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

type TenancyRepository = Pick<
  InMemoryTenancyRepository,
  'findMembershipByTenantAndUser'
>;

type ConversationRepository = Pick<
  InMemoryConversationRepository,
  'getConversation'
>;

type GuestSessionInvalidator = {
  revokeUserSessions: (
    tenantId: string,
    userId: string,
    reason?: string,
  ) => Promise<number>;
};

type GuestRealtimeInvalidator = {
  invalidateUserSubscriptions: (input: {
    tenantId: string;
    userId: string;
  }) => Promise<number>;
};

const noopSessionInvalidator: GuestSessionInvalidator = {
  revokeUserSessions: async () => 0,
};

const noopRealtimeInvalidator: GuestRealtimeInvalidator = {
  invalidateUserSubscriptions: async () => 0,
};

export class GuestGovernanceError extends Error {
  constructor(
    public readonly code:
      | 'ADMIN_ROLE_REQUIRED'
      | 'ACTIVE_MEMBERSHIP_REQUIRED'
      | 'GUEST_MEMBERSHIP_REQUIRED'
      | 'GUEST_IDENTITY_NOT_FOUND'
      | 'CONVERSATION_NOT_FOUND'
      | 'CONVERSATION_SCOPE_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'GuestGovernanceError';
  }
}

export class InMemoryGuestAccessRepository {
  private readonly identities = new Map<string, GuestIdentity>();
  private readonly scopes = new Map<string, GuestScope>();

  async saveGuestIdentity(identity: GuestIdentity): Promise<void> {
    this.identities.set(identity.id, cloneGuestIdentity(identity));
  }

  async findGuestIdentityByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<GuestIdentity | null> {
    for (const identity of this.identities.values()) {
      if (identity.tenantId === tenantId && identity.userId === userId) {
        return freezeGuestIdentity(cloneGuestIdentity(identity));
      }
    }

    return null;
  }

  async listGuestIdentitiesByTenant(tenantId: string): Promise<GuestIdentity[]> {
    return Array.from(this.identities.values())
      .filter((identity) => identity.tenantId === tenantId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((identity) => freezeGuestIdentity(cloneGuestIdentity(identity)));
  }

  async saveScope(scope: GuestScope): Promise<void> {
    this.scopes.set(scope.id, cloneGuestScope(scope));
  }

  async findActiveScope(input: {
    tenantId: string;
    guestUserId: string;
    conversationId: string;
  }): Promise<GuestScope | null> {
    for (const scope of this.scopes.values()) {
      if (
        scope.tenantId === input.tenantId &&
        scope.guestUserId === input.guestUserId &&
        scope.conversationId === input.conversationId &&
        scope.revokedAt === undefined
      ) {
        return freezeGuestScope(cloneGuestScope(scope));
      }
    }

    return null;
  }

  async listActiveScopesForGuest(input: {
    tenantId: string;
    guestUserId: string;
  }): Promise<GuestScope[]> {
    return Array.from(this.scopes.values())
      .filter(
        (scope) =>
          scope.tenantId === input.tenantId &&
          scope.guestUserId === input.guestUserId &&
          scope.revokedAt === undefined,
      )
      .map((scope) => freezeGuestScope(cloneGuestScope(scope)));
  }

  async saveScopes(scopes: GuestScope[]): Promise<void> {
    for (const scope of scopes) {
      this.scopes.set(scope.id, cloneGuestScope(scope));
    }
  }
}

type GuestRepository = Pick<
  InMemoryGuestAccessRepository,
  | 'saveGuestIdentity'
  | 'findGuestIdentityByTenantAndUser'
  | 'listGuestIdentitiesByTenant'
  | 'saveScope'
  | 'saveScopes'
  | 'findActiveScope'
  | 'listActiveScopesForGuest'
>;

export class GuestAccessService {
  constructor(
    private readonly repository: GuestRepository,
    private readonly tenancyRepository: TenancyRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly auditService: Pick<AuditEventService, 'writeEvent'>,
    private readonly clock: Clock = defaultClock,
    private readonly sessionInvalidator: GuestSessionInvalidator = noopSessionInvalidator,
    private readonly realtimeInvalidator: GuestRealtimeInvalidator = noopRealtimeInvalidator,
  ) {}

  async createGuestIdentity(
    input: CreateGuestIdentityRequest,
  ): Promise<GuestIdentity> {
    const actor = await this.requireAdminMembership(
      input.tenantId,
      input.actorUserId,
    );
    await this.requireGuestMembership(input.tenantId, input.guestUserId);

    const existing = await this.repository.findGuestIdentityByTenantAndUser(
      input.tenantId,
      input.guestUserId,
    );
    if (existing) {
      return existing;
    }

    const baseIdentity = {
      id: randomUUID(),
      tenantId: input.tenantId,
      officeId: input.officeId,
      userId: input.guestUserId,
      status: 'active' as const,
      createdBy: input.actorUserId,
      createdAt: this.clock.now().toISOString(),
    };
    const identity: GuestIdentity =
      input.displayName === undefined
        ? baseIdentity
        : {
            ...baseIdentity,
            displayName: input.displayName,
          };

    await this.repository.saveGuestIdentity(identity);
    await this.auditService.writeEvent({
      tenantId: input.tenantId,
      officeId: input.officeId,
      actorId: input.actorUserId,
      type: 'guest.identity_created',
      metadata: {
        guestId: identity.id,
        guestUserId: identity.userId,
        actorRole: actor.role,
      },
    });

    return freezeGuestIdentity(cloneGuestIdentity(identity));
  }

  async grantConversationScopes(
    input: GrantGuestScopeRequest,
  ): Promise<GuestScope[]> {
    await this.requireAdminMembership(input.tenantId, input.actorUserId);
    await this.requireGuestIdentity(input.tenantId, input.guestUserId);

    const grants: GuestScope[] = [];

    for (const conversationId of uniqueIds(input.conversationIds)) {
      const conversation = await this.requireScopeableConversation({
        tenantId: input.tenantId,
        officeId: input.officeId,
        conversationId,
      });
      const existing = await this.repository.findActiveScope({
        tenantId: input.tenantId,
        guestUserId: input.guestUserId,
        conversationId,
      });

      if (existing) {
        grants.push(existing);
        continue;
      }

      const scope: GuestScope = {
        id: randomUUID(),
        tenantId: input.tenantId,
        officeId: input.officeId,
        guestUserId: input.guestUserId,
        conversationId,
        grantedBy: input.actorUserId,
        createdAt: this.clock.now().toISOString(),
      };
      await this.repository.saveScope(scope);
      await this.auditService.writeEvent({
        tenantId: input.tenantId,
        officeId: input.officeId,
        actorId: input.actorUserId,
        type: 'guest.scope_granted',
        metadata: {
          guestUserId: input.guestUserId,
          conversationId: conversation.id,
        },
      });
      grants.push(freezeGuestScope(cloneGuestScope(scope)));
    }

    return grants;
  }

  async revokeConversationScope(
    input: RevokeGuestScopeRequest,
  ): Promise<GuestScope> {
    await this.requireAdminMembership(input.tenantId, input.actorUserId);
    await this.requireGuestIdentity(input.tenantId, input.guestUserId);
    const existing = await this.repository.findActiveScope({
      tenantId: input.tenantId,
      guestUserId: input.guestUserId,
      conversationId: input.conversationId,
    });

    if (!existing) {
      throw new GuestGovernanceError(
        'CONVERSATION_NOT_FOUND',
        'Guest scope does not exist for this conversation.',
      );
    }

    const revoked: GuestScope = {
      ...existing,
      revokedAt: this.clock.now().toISOString(),
      revokedBy: input.actorUserId,
    };

    await this.repository.saveScope(revoked);
    await this.auditService.writeEvent({
      tenantId: input.tenantId,
      officeId: input.officeId,
      actorId: input.actorUserId,
      type: 'guest.scope_revoked',
      metadata: {
        guestUserId: input.guestUserId,
        conversationId: input.conversationId,
      },
    });

    return freezeGuestScope(cloneGuestScope(revoked));
  }

  async canAccessConversation(input: {
    tenantId: string;
    guestUserId: string;
    conversationId: string;
  }): Promise<boolean> {
    const identity = await this.repository.findGuestIdentityByTenantAndUser(
      input.tenantId,
      input.guestUserId,
    );

    if (!identity || identity.status !== 'active') {
      return false;
    }

    const scope = await this.repository.findActiveScope(input);

    return scope !== null;
  }

  async listGuestDirectory(input: {
    tenantId: string;
    actorUserId: string;
  }): Promise<GuestDirectoryEntry[]> {
    await this.requireAdminMembership(input.tenantId, input.actorUserId);

    return (await this.repository.listGuestIdentitiesByTenant(input.tenantId))
      .filter((identity) => identity.status === 'active')
      .map(toGuestDirectoryEntry);
  }

  async listGrantedConversationIds(input: {
    tenantId: string;
    guestUserId: string;
  }): Promise<string[]> {
    const scopes = await this.repository.listActiveScopesForGuest(input);

    return scopes.map((scope) => scope.conversationId);
  }

  async killGuestAccess(
    input: KillGuestAccessRequest,
  ): Promise<KillGuestAccessResult> {
    await this.requireAdminMembership(input.tenantId, input.actorUserId);
    const identity = await this.requireGuestIdentity(
      input.tenantId,
      input.guestUserId,
    );
    const revokedAt = this.clock.now().toISOString();
    const revokedIdentity =
      input.reason === undefined
        ? {
            ...identity,
            status: 'revoked' as const,
            revokedAt,
            revokedBy: input.actorUserId,
          }
        : {
            ...identity,
            status: 'revoked' as const,
            revokedAt,
            revokedBy: input.actorUserId,
            revocationReason: input.reason,
          };
    const activeScopes = await this.repository.listActiveScopesForGuest({
      tenantId: input.tenantId,
      guestUserId: input.guestUserId,
    });
    const revokedScopes = activeScopes.map((scope) => ({
      ...scope,
      revokedAt,
      revokedBy: input.actorUserId,
    }));
    const revokedSessionCount =
      await this.sessionInvalidator.revokeUserSessions(
        input.tenantId,
        input.guestUserId,
        'guest_kill_switch',
      );
    const invalidatedRealtimeSubscriptionCount =
      await this.realtimeInvalidator.invalidateUserSubscriptions({
        tenantId: input.tenantId,
        userId: input.guestUserId,
      });

    await this.repository.saveGuestIdentity(revokedIdentity);
    await this.repository.saveScopes(revokedScopes);
    await this.auditService.writeEvent({
      tenantId: input.tenantId,
      officeId: input.officeId,
      actorId: input.actorUserId,
      type: 'guest.kill_switch_activated',
      metadata:
        input.reason === undefined
          ? {
              guestId: identity.id,
              guestUserId: input.guestUserId,
              revokedScopeCount: revokedScopes.length,
              revokedSessionCount,
              invalidatedRealtimeSubscriptionCount,
            }
          : {
              guestId: identity.id,
              guestUserId: input.guestUserId,
              revokedScopeCount: revokedScopes.length,
              revokedSessionCount,
              invalidatedRealtimeSubscriptionCount,
              reason: input.reason,
            },
    });

    return Object.freeze({
      guestId: identity.id,
      guestUserId: input.guestUserId,
      status: 'revoked',
      revokedAt,
      revokedScopeCount: revokedScopes.length,
      revokedSessionCount,
      invalidatedRealtimeSubscriptionCount,
    });
  }

  private async requireAdminMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership = await this.requireActiveMembership(tenantId, userId);

    if (!isAdminRole(membership.role)) {
      throw new GuestGovernanceError(
        'ADMIN_ROLE_REQUIRED',
        'Only principal or office_admin actors may govern guest access.',
      );
    }

    return membership;
  }

  private async requireGuestMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership = await this.requireActiveMembership(tenantId, userId);

    if (membership.role !== 'guest') {
      throw new GuestGovernanceError(
        'GUEST_MEMBERSHIP_REQUIRED',
        'Guest identity records must target guest memberships.',
      );
    }

    return membership;
  }

  private async requireGuestIdentity(
    tenantId: string,
    guestUserId: string,
  ): Promise<GuestIdentity> {
    const identity = await this.repository.findGuestIdentityByTenantAndUser(
      tenantId,
      guestUserId,
    );

    if (!identity || identity.status !== 'active') {
      throw new GuestGovernanceError(
        'GUEST_IDENTITY_NOT_FOUND',
        'Guest identity does not exist or is not active.',
      );
    }

    return identity;
  }

  private async requireActiveMembership(
    tenantId: string,
    userId: string,
  ): Promise<Membership> {
    const membership =
      await this.tenancyRepository.findMembershipByTenantAndUser(
        tenantId,
        userId,
      );

    if (!membership || membership.status !== 'active') {
      throw new GuestGovernanceError(
        'ACTIVE_MEMBERSHIP_REQUIRED',
        'Guest governance requires an active tenant membership.',
      );
    }

    return membership;
  }

  private async requireScopeableConversation(input: {
    tenantId: string;
    officeId: string;
    conversationId: string;
  }): Promise<Conversation> {
    const conversation = await this.conversationRepository.getConversation(
      input.conversationId,
    );

    if (!conversation) {
      throw new GuestGovernanceError(
        'CONVERSATION_NOT_FOUND',
        'Conversation does not exist.',
      );
    }

    if (
      conversation.tenantId !== input.tenantId ||
      conversation.officeId !== input.officeId
    ) {
      throw new GuestGovernanceError(
        'CONVERSATION_SCOPE_MISMATCH',
        'Guest scopes may only target conversations in the same office.',
      );
    }

    return conversation;
  }
}

function toGuestDirectoryEntry(identity: GuestIdentity): GuestDirectoryEntry {
  return identity.displayName === undefined
    ? Object.freeze({
        guestId: identity.id,
        userId: identity.userId,
        status: identity.status,
      })
    : Object.freeze({
        guestId: identity.id,
        userId: identity.userId,
        displayName: identity.displayName,
        status: identity.status,
      });
}

function isAdminRole(role: AuthRole): boolean {
  return role === 'principal' || role === 'office_admin';
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function cloneGuestIdentity(identity: GuestIdentity): GuestIdentity {
  return { ...identity };
}

function cloneGuestScope(scope: GuestScope): GuestScope {
  return { ...scope };
}

function freezeGuestIdentity(identity: GuestIdentity): GuestIdentity {
  return Object.freeze(identity);
}

function freezeGuestScope(scope: GuestScope): GuestScope {
  return Object.freeze(scope);
}
