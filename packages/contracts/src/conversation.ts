import type { AuthRole } from './auth';

export type ConversationTier =
  | 'personal'
  | 'confidential'
  | 'restricted';

export type ConversationParticipant = {
  id: string;
  conversationId: string;
  userId: string;
  role: AuthRole;
  createdAt: string;
};

export type Conversation = {
  id: string;
  tenantId: string;
  officeId: string;
  tier: ConversationTier;
  createdBy: string;
  createdAt: string;
};

export type CreateConversationRequest = {
  tenantId: string;
  actorUserId: string;
  tier: ConversationTier;
  participantIds: string[];
};

export type ConversationResponse = {
  id: string;
  tenantId: string;
  officeId: string;
  tier: ConversationTier;
  createdBy: string;
  participantIds: string[];
};
