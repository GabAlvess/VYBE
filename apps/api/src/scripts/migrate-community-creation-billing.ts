import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { CommunityRequest } from '../models/CommunityRequest.js';
import { PlatformProductSettings } from '../models/PlatformProductSettings.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI é obrigatório para preparar os índices da cobrança de comunidades.');

try {
  const mongoOptions = process.env.NODE_ENV === 'development'
    ? { dbName: process.env.VYBE_DEV_DB_NAME ?? 'vybe_dev' }
    : {};
  await mongoose.connect(process.env.MONGODB_URI, mongoOptions);
  await Promise.all([CommunityRequest.createIndexes(), PlatformProductSettings.createIndexes()]);
  console.log('Índices da cobrança de criação de comunidades preparados. Nenhum documento existente foi alterado.');
} finally {
  await mongoose.disconnect();
}
