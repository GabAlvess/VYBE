import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { ACCOUNT_GENDER_VALUES, GREETING_PREFERENCE_VALUES, mapLegacyAccountGender } from '@vybe/shared';
import { VybeAccount } from '../models/VybeAccount.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is required. Configure it in the local .env file.');
  process.exit(1);
}

try {
  const mongoOptions = process.env.NODE_ENV === 'development'
    ? { dbName: process.env.VYBE_DEV_DB_NAME ?? 'vybe_dev' }
    : {};
  await mongoose.connect(uri, mongoOptions);
  const historicalGenderLabels = ['female', 'woman', 'mulher', 'feminino', 'feminine', 'male', 'man', 'homem', 'masculino', 'masculine', 'non_binary', 'nonbinary', 'não-binário', 'nao-binario', 'prefiro não informar', 'prefiro nao informar', 'prefer_not_to_say'];
  const cursor = VybeAccount.collection.find({ $or: [
    { gender: { $exists: true } },
    { sex: { $exists: true } },
    { greetingPreference: { $exists: false } },
    { gender: 'CUSTOM', customGender: { $in: historicalGenderLabels } },
  ] });
  let migrated = 0;
  for await (const account of cursor) {
    const update: Record<string, unknown> = {};
    if (!GREETING_PREFERENCE_VALUES.includes(account.greetingPreference as typeof GREETING_PREFERENCE_VALUES[number])) {
      update.greetingPreference = 'NEUTRAL';
    }
    if (account.gender === 'CUSTOM' && typeof account.customGender === 'string' && historicalGenderLabels.includes(account.customGender.toLowerCase())) {
      const mappedCustom = mapLegacyAccountGender(account.customGender);
      if (mappedCustom && mappedCustom.gender !== 'CUSTOM') {
        update.gender = mappedCustom.gender;
        update.customGender = '';
      }
    } else if (!ACCOUNT_GENDER_VALUES.includes(account.gender as typeof ACCOUNT_GENDER_VALUES[number])) {
      const legacyValue = account.gender ?? account.sex;
      const mapped = mapLegacyAccountGender(legacyValue);
      if (mapped) {
        update.gender = mapped.gender;
        if (mapped.customGender) update.customGender = mapped.customGender;
      }
    }
    if (Object.keys(update).length) {
      await VybeAccount.collection.updateOne({ _id: account._id }, { $set: update });
      migrated += 1;
    }
  }
  console.log(`Migração do perfil central concluída. Contas atualizadas: ${migrated}. Preferência padrão: forma neutra.`);
} catch (error) {
  console.error('Não foi possível migrar os perfis da conta VYBE.', error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
