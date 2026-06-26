export type AttachmentStatus = 'upload_pending' | 'available';

export type Attachment = {
  id: string;
  tenantId: string;
  officeId: string;
  conversationId: string;
  storageKey: string;
  filename: string;
  contentType: string;
  byteSize: number;
  uploadedBy: string;
  status: AttachmentStatus;
  createdAt: string;
  messageId?: string;
  finalizedAt?: string;
};

export type CreateUploadIntentRequest = {
  tenantId: string;
  actorUserId: string;
  conversationId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  messageId?: string;
};

export type UploadIntentResponse = {
  attachmentId: string;
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
};

export type FinalizeAttachmentRequest = {
  tenantId: string;
  actorUserId: string;
  attachmentId: string;
};

export type AuthorizeAttachmentDownloadRequest = {
  tenantId: string;
  actorUserId: string;
  attachmentId: string;
};

export type SignedAttachmentDownload = {
  attachmentId: string;
  downloadUrl: string;
  expiresAt: string;
};
