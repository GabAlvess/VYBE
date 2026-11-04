import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { canReplyToSupportTicket, statusAfterUserSupportReply, supportTicketOwnerFilter } from './routes/supportTicketPolicy.js';

test('ticket owner filter always binds the ticket to the authenticated central account', () => {
  const authenticatedAccountId = new mongoose.Types.ObjectId();
  const filter = supportTicketOwnerFilter('ticket-id', authenticatedAccountId);
  assert.deepEqual(filter, { _id: 'ticket-id', createdByGlobalAccountId: authenticatedAccountId });
  assert.notEqual(filter.createdByGlobalAccountId.toString(), new mongoose.Types.ObjectId().toString());
});

test('resolved and closed tickets are read-only', () => {
  assert.equal(canReplyToSupportTicket('RESOLVED'), false);
  assert.equal(statusAfterUserSupportReply(), 'IN_PROGRESS');
  assert.equal(canReplyToSupportTicket('CLOSED'), false);
  assert.equal(canReplyToSupportTicket('IN_PROGRESS'), true);
});
