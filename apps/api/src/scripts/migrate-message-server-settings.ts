import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MessageServer, MessageServerCategory, MessageServerChannel, MessageServerMember, MessageServerMessage, MessageServerPost, MessageServerPostReply } from '../models/MessageServer.js';
import { MessageServerAccessRequest, MessageServerAudit, MessageServerBan, MessageServerConfig, MessageServerCustomRole, MessageServerInvite, MessageServerRestriction } from '../models/MessageServerAdmin.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI é obrigatório para preparar os índices dos servidores de Mensagens.');

try {
  const mongoOptions = process.env.NODE_ENV === 'development' ? { dbName: process.env.VYBE_DEV_DB_NAME ?? 'vybe_dev' } : {};
  await mongoose.connect(process.env.MONGODB_URI, mongoOptions);
  await Promise.all([
    MessageServer.createIndexes(), MessageServerMember.createIndexes(), MessageServerCategory.createIndexes(), MessageServerChannel.createIndexes(), MessageServerMessage.createIndexes(), MessageServerPost.createIndexes(), MessageServerPostReply.createIndexes(),
    MessageServerConfig.createIndexes(), MessageServerCustomRole.createIndexes(), MessageServerInvite.createIndexes(), MessageServerBan.createIndexes(), MessageServerRestriction.createIndexes(), MessageServerAccessRequest.createIndexes(), MessageServerAudit.createIndexes(),
  ]);
  console.log('Índices dos servidores independentes e de suas configurações preparados. Nenhum servidor, membro, mensagem ou comunidade foi alterado.');
} finally {
  await mongoose.disconnect();
}
