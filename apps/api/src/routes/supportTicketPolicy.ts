import mongoose from 'mongoose';

/** Scope every requester lookup to the authenticated central VYBE account. */
export function supportTicketOwnerFilter(ticketId: string, authenticatedAccountId: mongoose.Types.ObjectId) {
  return { _id: ticketId, createdByGlobalAccountId: authenticatedAccountId };
}

export function canReplyToSupportTicket(status: string) {
  return status !== 'CLOSED' && status !== 'RESOLVED';
}

export function statusAfterUserSupportReply() {
  return 'IN_PROGRESS' as const;
}
