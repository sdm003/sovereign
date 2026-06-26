import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AuditEventService,
  InMemoryAuditEventRepository,
} from '../audit';
import {
  AttachmentPipelineError,
  AttachmentService,
  InMemoryAttachmentRepository,
  attachmentSchemaSql,
} from './index';
import {
  ConversationPolicyError,
  ConversationService,
  InMemoryConversationRepository,
} from '../conversation';
import { InMemoryTenancyRepository, TenancyService } from '../tenancy';

async function createFixture() {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);
  const tenant = await tenancyService.createTenant({ name: 'Attachment Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Attachment Office',
  });

  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'principal-1',
    role: 'principal',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    role: 'member',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'outsider-1',
    role: 'member',
    status: 'active',
  });

  const conversationRepository = new InMemoryConversationRepository();
  const conversationService = new ConversationService(
    conversationRepository,
    tenancyRepository,
  );
  const conversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'confidential',
    participantIds: ['member-1'],
  });
  const privateConversation = await conversationService.createConversation({
    tenantId: tenant.id,
    actorUserId: 'outsider-1',
    tier: 'confidential',
    participantIds: [],
  });

  const auditRepository = new InMemoryAuditEventRepository();
  const auditTimestamps = [
    '2026-06-26T11:40:00.000Z',
    '2026-06-26T11:41:00.000Z',
    '2026-06-26T11:42:00.000Z',
  ];
  const auditService = new AuditEventService(auditRepository, {
    now: () =>
      new Date(auditTimestamps.shift() ?? '2026-06-26T11:43:00.000Z'),
  });
  const attachmentRepository = new InMemoryAttachmentRepository();
  const signer = new DeterministicStorageSigner();
  const attachmentService = new AttachmentService(
    attachmentRepository,
    conversationService,
    auditService,
    signer,
    {
      now: () => new Date('2026-06-26T11:40:00.000Z'),
    },
  );

  return {
    attachmentRepository,
    attachmentService,
    auditService,
    conversation,
    privateConversation,
    signer,
    tenant,
  };
}

test('creates signed upload intents with tenant-safe storage keys and audit coverage', async () => {
  const { attachmentService, auditService, conversation, tenant } =
    await createFixture();

  const intent = await attachmentService.createUploadIntent({
    tenantId: tenant.id,
    actorUserId: 'member-1',
    conversationId: conversation.id,
    filename: 'passport.pdf',
    contentType: 'application/pdf',
    byteSize: 42_000,
    messageId: 'message-1',
  });

  assert.equal(intent.uploadUrl, `https://storage.example/upload/${intent.storageKey}`);
  assert.match(intent.storageKey, new RegExp(`^tenants/${tenant.id}/conversations/${conversation.id}/attachments/`));
  assert.equal(intent.expiresAt, '2026-06-26T11:55:00.000Z');

  const events = await auditService.listTenantEvents(tenant.id);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'file.upload_intent_created');
  assert.equal(events[0]?.metadata.conversationId, conversation.id);
  assert.equal(events[0]?.metadata.filename, 'passport.pdf');
});

test('finalizes attachment metadata and authorizes signed downloads', async () => {
  const { attachmentService, auditService, conversation, tenant } =
    await createFixture();
  const intent = await attachmentService.createUploadIntent({
    tenantId: tenant.id,
    actorUserId: 'member-1',
    conversationId: conversation.id,
    filename: 'passport.pdf',
    contentType: 'application/pdf',
    byteSize: 42_000,
    messageId: 'message-1',
  });

  const attachment = await attachmentService.finalizeAttachment({
    tenantId: tenant.id,
    actorUserId: 'member-1',
    attachmentId: intent.attachmentId,
  });
  const metadata = await attachmentService.getAttachmentMetadata({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    attachmentId: attachment.id,
  });
  const download = await attachmentService.authorizeDownload({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    attachmentId: attachment.id,
  });

  assert.equal(attachment.status, 'available');
  assert.equal(metadata.id, attachment.id);
  assert.equal(attachment.filename, 'passport.pdf');
  assert.equal(attachment.messageId, 'message-1');
  assert.equal(download.downloadUrl, `https://storage.example/download/${attachment.storageKey}`);
  assert.equal(download.expiresAt, '2026-06-26T11:55:00.000Z');
  assert.deepEqual(
    (await auditService.listTenantEvents(tenant.id)).map((event) => event.type),
    [
      'file.download_authorized',
      'file.metadata_viewed',
      'file.attachment_finalized',
      'file.upload_intent_created',
    ],
  );
});

test('denies upload and download when the actor cannot access the conversation', async () => {
  const { attachmentService, conversation, privateConversation, tenant } =
    await createFixture();

  await assert.rejects(
    attachmentService.createUploadIntent({
      tenantId: tenant.id,
      actorUserId: 'member-1',
      conversationId: privateConversation.id,
      filename: 'hidden.pdf',
      contentType: 'application/pdf',
      byteSize: 10,
    }),
    (error: unknown) =>
      error instanceof ConversationPolicyError &&
      error.code === 'CONVERSATION_ACCESS_DENIED',
  );

  const intent = await attachmentService.createUploadIntent({
    tenantId: tenant.id,
    actorUserId: 'member-1',
    conversationId: conversation.id,
    filename: 'visible.pdf',
    contentType: 'application/pdf',
    byteSize: 10,
  });
  const attachment = await attachmentService.finalizeAttachment({
    tenantId: tenant.id,
    actorUserId: 'member-1',
    attachmentId: intent.attachmentId,
  });

  await assert.rejects(
    attachmentService.authorizeDownload({
      tenantId: tenant.id,
      actorUserId: 'outsider-1',
      attachmentId: attachment.id,
    }),
    (error: unknown) =>
      error instanceof ConversationPolicyError &&
      error.code === 'CONVERSATION_ACCESS_DENIED',
  );
});

test('rejects duplicate finalize and download before finalize, and exposes SQL schema', async () => {
  const { attachmentService, conversation, tenant } = await createFixture();
  const intent = await attachmentService.createUploadIntent({
    tenantId: tenant.id,
    actorUserId: 'member-1',
    conversationId: conversation.id,
    filename: 'draft.pdf',
    contentType: 'application/pdf',
    byteSize: 10,
  });

  await assert.rejects(
    attachmentService.authorizeDownload({
      tenantId: tenant.id,
      actorUserId: 'member-1',
      attachmentId: intent.attachmentId,
    }),
    (error: unknown) =>
      error instanceof AttachmentPipelineError &&
      error.code === 'ATTACHMENT_NOT_FINALIZED',
  );

  await attachmentService.finalizeAttachment({
    tenantId: tenant.id,
    actorUserId: 'member-1',
    attachmentId: intent.attachmentId,
  });
  await assert.rejects(
    attachmentService.finalizeAttachment({
      tenantId: tenant.id,
      actorUserId: 'member-1',
      attachmentId: intent.attachmentId,
    }),
    (error: unknown) =>
      error instanceof AttachmentPipelineError &&
      error.code === 'ATTACHMENT_ALREADY_FINALIZED',
  );

  assert.match(attachmentSchemaSql, /create table attachment/i);
  assert.match(attachmentSchemaSql, /storage_key text not null unique/i);
  assert.match(attachmentSchemaSql, /attachment_conversation_idx/i);
});

class DeterministicStorageSigner {
  async createUploadUrl(input: { storageKey: string }): Promise<string> {
    return `https://storage.example/upload/${input.storageKey}`;
  }

  async createDownloadUrl(input: { storageKey: string }): Promise<string> {
    return `https://storage.example/download/${input.storageKey}`;
  }
}
