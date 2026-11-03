import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';
import mongoose from 'mongoose';
import { Community } from '../models/Community.js';
import { Account, Character, Notification } from '../models/Social.js';
import { Conversation, ConversationMessage } from '../models/Conversation.js';
import { conversationDirectKey } from '../routes/conversationPolicy.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

if (process.env.NODE_ENV !== 'development') {
  console.error('Seed bloqueado: defina NODE_ENV=development para criar dados de demonstração.');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI é necessário.');
  process.exit(1);
}

const database = process.env.VYBE_DEV_DB_NAME || 'vybe_dev';
const tenantSlug = process.env.VYBE_MESSAGES_DEMO_TENANT || 'community';
const recipientUsername = process.env.VYBE_MESSAGES_DEMO_RECIPIENT || 'gabrielasathler';
const sender = {
  email: 'livia.mensagens-demo@vybe.test',
  username: 'livia.mensagens',
  displayName: 'Lívia Monteiro',
  bio: 'Gosto de conhecer pessoas e trocar boas histórias.',
};
const greeting = 'Oi, Gabriela! Passei para te mandar um oi 😊 Quando puder, me conta como está seu dia!';
const hashPassword = () => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(randomBytes(32).toString('hex'), salt, 64).toString('hex')}`;
};

try {
  await mongoose.connect(uri, { dbName: database });
  const tenant = await Community.findOne({ slug: tenantSlug }).select('_id').lean();
  if (!tenant) throw new Error(`Comunidade "${tenantSlug}" não encontrada no banco ${database}.`);
  const tenantId = (tenant as unknown as { _id: mongoose.Types.ObjectId })._id;
  const recipient = await Character.findOne({ tenantId, username: recipientUsername }).select('_id').lean();
  if (!recipient) throw new Error(`Perfil destinatário @${recipientUsername} não encontrado na comunidade "${tenantSlug}".`);

  const account = await Account.findOneAndUpdate(
    { tenantId, email: sender.email },
    { $setOnInsert: { tenantId, email: sender.email, passwordHash: hashPassword(), status: 'active' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const person = await Character.findOneAndUpdate(
    { tenantId, username: sender.username },
    { $set: { tenantId, accountId: account._id, username: sender.username, displayName: sender.displayName, bio: sender.bio }, $setOnInsert: { avatarUrl: '', coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0, seedKey: 'messages-demo-livia' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const directKey = conversationDirectKey(person._id, recipient._id);
  const conversation = await Conversation.findOneAndUpdate(
    { tenantId, kind: 'direct', directKey },
    { $setOnInsert: { tenantId, kind: 'direct', directKey, createdBy: person._id, participants: [{ profileId: person._id, role: 'member' }, { profileId: recipient._id, role: 'member' }] } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  let message = await ConversationMessage.findOne({ tenantId, conversationId: conversation._id, senderProfileId: person._id, content: greeting });
  if (!message) {
    message = await ConversationMessage.create({ tenantId, conversationId: conversation._id, senderProfileId: person._id, content: greeting, messageType: 'text' });
    await Conversation.updateOne({ _id: conversation._id, tenantId }, { $set: { lastMessageAt: message.createdAt } });
  }
  await Notification.findOneAndUpdate(
    { tenantId, seedKey: 'messages-demo-incoming-livia' },
    { $setOnInsert: { tenantId, characterId: recipient._id, actorId: person._id, type: 'message', targetId: message._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  console.log(`Contato de demonstração pronto: ${sender.displayName} (@${sender.username}) enviou uma mensagem e uma notificação para @${recipientUsername} em ${tenantSlug}.`);
} catch (error) {
  console.error('Não foi possível preparar a conversa de demonstração:', error instanceof Error ? error.message : 'erro desconhecido');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
