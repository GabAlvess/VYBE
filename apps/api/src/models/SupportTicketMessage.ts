import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  storageName: { type: String, required: true, match: /^[a-f0-9]{40}\.(png|jpg|webp|pdf)$/ },
  name: { type: String, required: true, maxlength: 180 },
  mimeType: { type: String, required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] },
  size: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
}, { _id: false });

const schema = new mongoose.Schema({
  ticketId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  senderGlobalAccountId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  senderType: { type: String, enum: ['USER', 'SUPPORT'], required: true },
  content: { type: String, default: '', maxlength: 4000 },
  attachments: { type: [attachmentSchema], default: [] },
}, { timestamps: true, collection: 'support_ticket_messages' });
schema.index({ ticketId: 1, createdAt: 1 });

export const SupportTicketMessage = mongoose.models.SupportTicketMessage ?? mongoose.model('SupportTicketMessage', schema);
