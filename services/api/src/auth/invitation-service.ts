import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type {
  AuthContext,
  CompleteInviteAuthRequest,
  CompleteInviteAuthResponse,
  InvitationStatus,
  IssueInvitationRequest,
  IssueInvitationResponse,
} from '@sovereign/contracts';

type InvitationRecord = {
  id: string;
  tenantId: string;
  officeId: string;
  userId: string;
  email: string;
  role: AuthContext['role'];
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
};

type IssueSessionInput = {
  invitationId: string;
  userId: string;
  authContext: AuthContext;
  deviceMetadata?: CompleteInviteAuthRequest['deviceMetadata'];
};

type SessionIssuer = {
  issueSession: (
    input: IssueSessionInput,
  ) => Promise<CompleteInviteAuthResponse>;
};

type Clock = {
  now: () => Date;
};

const defaultSessionIssuer: SessionIssuer = {
  issueSession: async ({ authContext }) => ({
    accessToken: randomBytes(32).toString('base64url'),
    refreshToken: randomBytes(48).toString('base64url'),
    authContext,
  }),
};

const defaultClock: Clock = {
  now: () => new Date(),
};

export class InvitationAuthError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_TOKEN'
      | 'EXPIRED_TOKEN'
      | 'INVITATION_ALREADY_USED'
      | 'INVITATION_REVOKED',
    message: string,
  ) {
    super(message);
    this.name = 'InvitationAuthError';
  }
}

export class InMemoryInvitationRepository {
  private readonly invitations = new Map<string, InvitationRecord>();

  async create(invitation: InvitationRecord): Promise<void> {
    this.invitations.set(invitation.id, invitation);
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    for (const invitation of this.invitations.values()) {
      if (invitation.tokenHash === tokenHash) {
        return { ...invitation };
      }
    }

    return null;
  }

  async save(invitation: InvitationRecord): Promise<void> {
    this.invitations.set(invitation.id, invitation);
  }

  list(): InvitationRecord[] {
    return Array.from(this.invitations.values()).map((invitation) => ({
      ...invitation,
    }));
  }
}

type InvitationRepository = Pick<
  InMemoryInvitationRepository,
  'create' | 'findByTokenHash' | 'save'
>;

export class InvitationAuthService {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly sessionIssuer: SessionIssuer = defaultSessionIssuer,
    private readonly clock: Clock = defaultClock,
  ) {}

  async issueInvitation(
    request: IssueInvitationRequest,
  ): Promise<IssueInvitationResponse> {
    const token = randomBytes(32).toString('base64url');
    const invitation: InvitationRecord = {
      id: randomUUID(),
      tenantId: request.tenantId,
      officeId: request.officeId,
      userId: request.userId,
      email: request.email,
      role: request.role,
      tokenHash: hashToken(token),
      status: 'pending',
      expiresAt: request.expiresAt,
      createdAt: this.clock.now().toISOString(),
    };

    await this.repository.create(invitation);

    return {
      invitationId: invitation.id,
      token,
      expiresAt: invitation.expiresAt,
    };
  }

  async completeInvitationAuth(
    request: CompleteInviteAuthRequest,
  ): Promise<CompleteInviteAuthResponse> {
    const invitation = await this.repository.findByTokenHash(
      hashToken(request.token),
    );

    if (!invitation) {
      throw new InvitationAuthError(
        'INVALID_TOKEN',
        'Invitation token is invalid.',
      );
    }

    if (invitation.status === 'completed') {
      throw new InvitationAuthError(
        'INVITATION_ALREADY_USED',
        'Invitation token has already been used.',
      );
    }

    if (invitation.status === 'revoked') {
      throw new InvitationAuthError(
        'INVITATION_REVOKED',
        'Invitation token has been revoked.',
      );
    }

    const now = this.clock.now();
    const expiresAt = new Date(invitation.expiresAt);

    if (expiresAt.getTime() <= now.getTime()) {
      invitation.status = 'expired';
      await this.repository.save(invitation);
      throw new InvitationAuthError(
        'EXPIRED_TOKEN',
        'Invitation token has expired.',
      );
    }

    const authContext: AuthContext = {
      tenantId: invitation.tenantId,
      officeId: invitation.officeId,
      role: invitation.role,
    };

    const session = await this.sessionIssuer.issueSession({
      invitationId: invitation.id,
      userId: invitation.userId,
      authContext,
      deviceMetadata: request.deviceMetadata,
    });

    invitation.status = 'completed';
    invitation.completedAt = now.toISOString();
    await this.repository.save(invitation);

    return session;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
