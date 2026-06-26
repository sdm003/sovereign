export type DissolutionStatus = 'pending_confirmation' | 'completed' | 'rejected';

export type DissolutionRequestRecord = {
  id: string;
  tenantId: string;
  officeId: string;
  conversationId: string;
  status: DissolutionStatus;
  requestedBy: string;
  createdAt: string;
  confirmedBy?: string;
  rejectedBy?: string;
  resolvedAt?: string;
  rejectionReason?: string;
};

export type DissolutionTransitionAction = 'request' | 'confirm' | 'reject';

export type DissolutionTransitionRequest = {
  tenantId: string;
  actorUserId: string;
  conversationId: string;
  action: DissolutionTransitionAction;
  reason?: string;
};

export type RequestDissolutionInput = Omit<
  DissolutionTransitionRequest,
  'action' | 'reason'
>;

export type ConfirmDissolutionInput = Omit<
  DissolutionTransitionRequest,
  'action' | 'reason'
>;

export type RejectDissolutionInput = Omit<
  DissolutionTransitionRequest,
  'action'
>;
