import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { migrateVerificationBeneficiaries } from '../services/migrateVerificationBeneficiaries.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI é necessário para migrar as solicitações VYBE+.');
  process.exit(1);
}

try {
  const mongoOptions = process.env.NODE_ENV === 'development'
    ? { dbName: process.env.VYBE_DEV_DB_NAME ?? 'vybe_dev' }
    : {};
  await mongoose.connect(uri, mongoOptions);

  const migration = await migrateVerificationBeneficiaries();
  console.log(`Migração VYBE+ concluída. Solicitações legadas atualizadas: ${migration.modifiedCount}; índice antigo removido: ${migration.legacyIndexRemoved}.`);
} catch (error) {
  console.error('Não foi possível migrar as solicitações VYBE+.', error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
