export const auditEventTypes = [
  'auth.invitation_issued',
  'auth.session_issued',
  'device.enrolled',
  'device.approved',
  'device.revoked',
  'restricted.hardware_key_registered',
  'restricted.hardware_key_revoked',
  'restricted.session_activated',
  'restricted.session_activation_denied',
  'membership.created',
  'membership.status_changed',
  'guest.identity_created',
  'guest.scope_granted',
  'guest.scope_revoked',
  'guest.kill_switch_activated',
  'file.upload_intent_created',
  'file.attachment_finalized',
  'file.metadata_viewed',
  'file.download_authorized',
  'file.access_denied',
  'tier.conversation_tier_changed',
  'dissolution.requested',
  'dissolution.resolved',
  'recovery.requested',
  'recovery.admin_approved',
  'recovery.sim_verified',
  'recovery.completed',
  'support.elevation_requested',
  'support.elevation_granted',
  'support.elevation_revoked',
] as const;

export type AuditEventType = (typeof auditEventTypes)[number];

export type AuditEventMetadataValue =
  | string
  | number
  | boolean
  | null
  | AuditEventMetadataValue[]
  | {
      [key: string]: AuditEventMetadataValue;
    };

export type AuditEventMetadata = Record<string, AuditEventMetadataValue>;

export type AuditEvent = {
  id: string;
  tenantId: string;
  officeId: string;
  type: AuditEventType;
  metadata: AuditEventMetadata;
  occurredAt: string;
  actorId?: string;
};

export type WriteAuditEventInput = {
  tenantId: string;
  officeId: string;
  type: string;
  metadata: AuditEventMetadata;
  actorId?: string;
};

export type AuditQueryParams = {
  actorId?: string;
  conversationId?: string;
  type?: AuditEventType;
  from?: string;
  to?: string;
};

export type AuditReviewListItem = {
  id: string;
  tenantId: string;
  officeId: string;
  type: AuditEventType;
  occurredAt: string;
  actorId?: string;
  conversationId?: string;
};

export type AuditReviewDetail = AuditReviewListItem & {
  metadata: AuditEventMetadata;
};
