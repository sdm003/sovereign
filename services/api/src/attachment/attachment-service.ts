import { randomUUID } from 'node:crypto';

import type {
  Attachment,
  AttachmentAccessEvaluation,
  AuthorizeAttachmentDownloadRequest,
  CreateUploadIntentRequest,
  FinalizeAttachmentRequest,
  SignedAttachmentDownload,
  UploadIntentResponse,
} from '@sovereign/contracts';

import type { AuditEventService } from '../audit';
import { ConversationPolicyError, type ConversationService } from '../conversation';

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

const signedUrlTtlMs = 15 * 60 * 1000;

type StorageSigner = {
  createUploadUrl: (input: {
    storageKey: string;
    contentType: string;
    byteSize: number;
    expiresAt: string;
  }) => Promise<string>;
  createDownloadUrl: (input: {
    storageKey: string;
    expiresAt: string;
  }) => Promise<string>;
};

export class AttachmentPipelineError extends Error {
  constructor(
    public readonly code:
      | 'ATTACHMENT_NOT_FOUND'
      | 'ATTACHMENT_NOT_FINALIZED'
      | 'ATTACHMENT_ALREADY_FINALIZED'
      | 'ATTACHMENT_ACCESS_DENIED'
      | 'INVALID_ATTACHMENT_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentPipelineError';
  }
}

export class InMemoryAttachmentRepository {
  private readonly attachments = new Map<string, Attachment>();

  async saveAttachment(attachment: Attachment): Promise<void> {
    this.attachments.set(attachment.id, cloneAttachment(attachment));
  }

  async getAttachment(id: string): Promise<Attachment | null> {
    const attachment = this.attachments.get(id);

    return attachment ? freezeAttachment(cloneAttachment(attachment)) : null;
  }

  async listByConversation(input: {
    tenantId: string;
    conversationId: string;
  }): Promise<Attachment[]> {
    return Array.from(this.attachments.values())
      .filter(
        (attachment) =>
          attachment.tenantId === input.tenantId &&
          attachment.conversationId === input.conversationId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((attachment) => freezeAttachment(cloneAttachment(attachment)));
  }
}

type AttachmentRepository = Pick<
  InMemoryAttachmentRepository,
  'saveAttachment' | 'getAttachment' | 'listByConversation'
>;

export class AttachmentService {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly conversationService: Pick<ConversationService, 'getConversation'>,
    private readonly auditService: Pick<AuditEventService, 'writeEvent'>,
    private readonly storageSigner: StorageSigner,
    private readonly clock: Clock = defaultClock,
  ) {}

  async createUploadIntent(
    input: CreateUploadIntentRequest,
  ): Promise<UploadIntentResponse> {
    assertValidUploadInput(input);
    const conversation = await this.conversationService.getConversation({
      tenantId: input.tenantId,
      userId: input.actorUserId,
      conversationId: input.conversationId,
    });
    const now = this.clock.now();
    const expiresAt = expiresAtFrom(now);
    const attachmentId = randomUUID();
    const storageKey = buildStorageKey({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      attachmentId,
      filename: input.filename,
    });
    const uploadUrl = await this.storageSigner.createUploadUrl({
      storageKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      expiresAt,
    });

    const baseAttachment = {
      id: attachmentId,
      tenantId: input.tenantId,
      officeId: conversation.officeId,
      conversationId: input.conversationId,
      storageKey,
      filename: input.filename,
      contentType: input.contentType,
      byteSize: input.byteSize,
      uploadedBy: input.actorUserId,
      status: 'upload_pending' as const,
      createdAt: now.toISOString(),
    };
    const attachment: Attachment =
      input.messageId === undefined
        ? baseAttachment
        : {
            ...baseAttachment,
            messageId: input.messageId,
          };

    await this.repository.saveAttachment(attachment);
    await this.auditService.writeEvent({
      tenantId: input.tenantId,
      officeId: conversation.officeId,
      actorId: input.actorUserId,
      type: 'file.upload_intent_created',
      metadata: {
        attachmentId,
        conversationId: input.conversationId,
        filename: input.filename,
        contentType: input.contentType,
        byteSize: input.byteSize,
      },
    });

    return Object.freeze({
      attachmentId,
      uploadUrl,
      storageKey,
      expiresAt,
    });
  }

  async finalizeAttachment(
    input: FinalizeAttachmentRequest,
  ): Promise<Attachment> {
    const attachment = await this.requireAttachment(
      input.tenantId,
      input.attachmentId,
    );

    if (attachment.status === 'available') {
      throw new AttachmentPipelineError(
        'ATTACHMENT_ALREADY_FINALIZED',
        'Attachment metadata is already finalized.',
      );
    }

    await this.requireConversationAccess(input, attachment);
    const finalizedAt = this.clock.now().toISOString();
    const finalized: Attachment = {
      ...attachment,
      status: 'available',
      finalizedAt,
    };

    await this.repository.saveAttachment(finalized);
    await this.auditService.writeEvent({
      tenantId: input.tenantId,
      officeId: attachment.officeId,
      actorId: input.actorUserId,
      type: 'file.attachment_finalized',
      metadata: {
        attachmentId: attachment.id,
        conversationId: attachment.conversationId,
        filename: attachment.filename,
      },
    });

    return freezeAttachment(cloneAttachment(finalized));
  }

  async authorizeDownload(
    input: AuthorizeAttachmentDownloadRequest,
  ): Promise<SignedAttachmentDownload> {
    const attachment = await this.requireAttachment(
      input.tenantId,
      input.attachmentId,
    );

    const access = await this.evaluateAttachmentAccess(input);
    if (access.state === 'not_visible') {
      await this.auditService.writeEvent({
        tenantId: input.tenantId,
        officeId: attachment.officeId,
        actorId: input.actorUserId,
        type: 'file.access_denied',
        metadata: {
          attachmentId: attachment.id,
          conversationId: attachment.conversationId,
          reason: access.reason,
        },
      });
      throw new AttachmentPipelineError(
        'ATTACHMENT_ACCESS_DENIED',
        'Attachment is not visible to this actor.',
      );
    }

    if (attachment.status !== 'available') {
      throw new AttachmentPipelineError(
        'ATTACHMENT_NOT_FINALIZED',
        'Attachment must be finalized before download authorization.',
      );
    }

    const expiresAt = expiresAtFrom(this.clock.now());
    const downloadUrl = await this.storageSigner.createDownloadUrl({
      storageKey: attachment.storageKey,
      expiresAt,
    });

    await this.auditService.writeEvent({
      tenantId: input.tenantId,
      officeId: attachment.officeId,
      actorId: input.actorUserId,
      type: 'file.download_authorized',
      metadata: {
        attachmentId: attachment.id,
        conversationId: attachment.conversationId,
        filename: attachment.filename,
      },
    });

    return Object.freeze({
      attachmentId: attachment.id,
      downloadUrl,
      expiresAt,
    });
  }

  async getAttachmentMetadata(input: {
    tenantId: string;
    actorUserId: string;
    attachmentId: string;
  }): Promise<Attachment> {
    const attachment = await this.requireAttachment(
      input.tenantId,
      input.attachmentId,
    );
    await this.requireConversationAccess(input, attachment);
    await this.auditService.writeEvent({
      tenantId: input.tenantId,
      officeId: attachment.officeId,
      actorId: input.actorUserId,
      type: 'file.metadata_viewed',
      metadata: {
        attachmentId: attachment.id,
        conversationId: attachment.conversationId,
      },
    });

    return freezeAttachment(cloneAttachment(attachment));
  }

  async evaluateAttachmentAccess(input: {
    tenantId: string;
    actorUserId: string;
    attachmentId: string;
  }): Promise<AttachmentAccessEvaluation> {
    const attachment = await this.requireAttachment(
      input.tenantId,
      input.attachmentId,
    );
    const conversation = await this.evaluateConversationAccess(input, attachment);

    if (!conversation.visible) {
      return Object.freeze({
        attachmentId: attachment.id,
        state: 'not_visible',
        canDownload: false,
        reason: 'conversation_not_visible',
      });
    }

    if (attachment.status !== 'available') {
      return Object.freeze({
        attachmentId: attachment.id,
        state: 'download_disabled',
        canDownload: false,
        reason: 'attachment_not_finalized',
      });
    }

    return Object.freeze({
      attachmentId: attachment.id,
      state: 'allowed',
      canDownload: true,
      reason: conversation.guestLimited
        ? 'guest_scope_allowed'
        : 'participant_allowed',
    });
  }

  private async requireAttachment(
    tenantId: string,
    attachmentId: string,
  ): Promise<Attachment> {
    const attachment = await this.repository.getAttachment(attachmentId);

    if (!attachment || attachment.tenantId !== tenantId) {
      throw new AttachmentPipelineError(
        'ATTACHMENT_NOT_FOUND',
        'Attachment metadata does not exist for this tenant.',
      );
    }

    return attachment;
  }

  private async requireConversationAccess(
    input: { tenantId: string; actorUserId: string },
    attachment: Attachment,
  ): Promise<void> {
    await this.conversationService.getConversation({
      tenantId: input.tenantId,
      userId: input.actorUserId,
      conversationId: attachment.conversationId,
    });
  }

  private async evaluateConversationAccess(
    input: { tenantId: string; actorUserId: string },
    attachment: Attachment,
  ): Promise<{ visible: boolean; guestLimited: boolean }> {
    try {
      const conversation = await this.conversationService.getConversation({
        tenantId: input.tenantId,
        userId: input.actorUserId,
        conversationId: attachment.conversationId,
      });

      return {
        visible: true,
        guestLimited:
          conversation.participantIds.length === 1 &&
          conversation.participantIds[0] === input.actorUserId &&
          attachment.uploadedBy !== input.actorUserId,
      };
    } catch (error: unknown) {
      if (error instanceof ConversationPolicyError) {
        return { visible: false, guestLimited: false };
      }
      throw error;
    }
  }
}

function assertValidUploadInput(input: CreateUploadIntentRequest): void {
  if (
    input.filename.trim() === '' ||
    input.contentType.trim() === '' ||
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize <= 0
  ) {
    throw new AttachmentPipelineError(
      'INVALID_ATTACHMENT_INPUT',
      'Upload intent requires filename, content type, and positive byte size.',
    );
  }
}

function expiresAtFrom(now: Date): string {
  return new Date(now.getTime() + signedUrlTtlMs).toISOString();
}

function buildStorageKey(input: {
  tenantId: string;
  conversationId: string;
  attachmentId: string;
  filename: string;
}): string {
  return [
    'tenants',
    input.tenantId,
    'conversations',
    input.conversationId,
    'attachments',
    `${input.attachmentId}-${sanitizeFilename(input.filename)}`,
  ].join('/');
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function cloneAttachment(attachment: Attachment): Attachment {
  return { ...attachment };
}

function freezeAttachment(attachment: Attachment): Attachment {
  return Object.freeze(attachment);
}
