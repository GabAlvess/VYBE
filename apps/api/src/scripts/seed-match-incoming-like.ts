import { config } from 'dotenv';
import { randomBytes, scryptSync } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Community } from '../models/Community.js';
import { Account, Character } from '../models/Social.js';
import { MatchProfile, MatchReaction } from '../models/Match.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

if (process.env.NODE_ENV !== 'development') {
  console.error('Seed bloqueado: defina NODE_ENV=development para usar dados de demonstração.');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
const database = process.env.VYBE_DEV_DB_NAME || 'vybe_dev';
const tenantSlug = process.env.VYBE_MATCH_DEMO_TENANT || 'community';
const targetUsername = process.env.VYBE_MATCH_DEMO_TARGET_USERNAME?.trim().replace(/^@/, '').toLowerCase();
const profiles = [
  { username: 'match.demo.lara', name: 'Lara Martins', age: 24, bio: 'Gosto de fotografia, cafés tranquilos e conversas que viram boas histórias.', location: 'Centro', interests: ['Fotografia', 'Café', 'Cinema'] },
  { username: 'match.demo.bruno', name: 'Bruno Azevedo', age: 27, bio: 'Sempre procurando uma trilha nova ou uma playlist para compartilhar.', location: 'Jardim das Artes', interests: ['Música', 'Trilhas', 'Viagens'] },
  { username: 'match.demo.camila', name: 'Camila Rocha', age: 22, bio: 'Entre livros, exposições e planos para conhecer lugares diferentes.', location: 'Vila Nova', interests: ['Livros', 'Arte', 'Viagens'] },
  { username: 'match.demo.theo', name: 'Theo Fernandes', age: 25, bio: 'Cozinho para os amigos e aceito recomendações de bons filmes.', location: 'Parque Norte', interests: ['Culinária', 'Cinema', 'Café'] },
  { username: 'match.demo.bia', name: 'Bia Almeida', age: 23, bio: 'Acredito que um show ao vivo e uma boa conversa sempre combinam.', location: 'Centro', interests: ['Shows', 'Música', 'Dança'] },
] as const;

const hashPassword = () => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(randomBytes(32).toString('hex'), salt, 64).toString('hex')}`;
};

if (!uri || !targetUsername) {
  console.error('MONGODB_URI e VYBE_MATCH_DEMO_TARGET_USERNAME são necessários.');
  process.exit(1);
}

try {
  await mongoose.connect(uri, { dbName: database, autoIndex: false });
  const tenant = await Community.findOne({ slug: tenantSlug }).select('_id').lean();
  if (!tenant) throw new Error(`Comunidade "${tenantSlug}" não encontrada no banco ${database}.`);
  const tenantId = (tenant as unknown as { _id: mongoose.Types.ObjectId })._id;
  const target = await Character.findOne({ tenantId, username: targetUsername }).select('_id accountId').lean();
  if (!target) throw new Error(`Perfil destinatário @${targetUsername} não encontrado nesta comunidade.`);
  const [targetAccount, targetProfile] = await Promise.all([
    Account.exists({ _id: target.accountId, tenantId, status: 'active' }),
    MatchProfile.findOne({ tenantId, characterId: target._id }).lean(),
  ]);
  if (!targetAccount) throw new Error(`A conta @${targetUsername} não está ativa nesta comunidade.`);
  if (!targetProfile?.enabled || !targetProfile.age) throw new Error('Ative o seu perfil do Match e informe sua idade antes de criar as curtidas de demonstração.');

  for (const [index, item] of profiles.entries()) {
    const email = `${item.username.replaceAll('.', '-')}@match-demo.vybe.test`;
    const account = await Account.findOneAndUpdate(
      { tenantId, email },
      { $setOnInsert: { tenantId, email, passwordHash: hashPassword(), status: 'active' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const character = await Character.findOneAndUpdate(
      { tenantId, username: item.username },
      { $set: { tenantId, accountId: account._id, username: item.username, displayName: item.name, bio: item.bio }, $setOnInsert: { avatarUrl: '', coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0, seedKey: `match-demo-${item.username}` } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await MatchProfile.findOneAndUpdate(
      { tenantId, characterId: character._id },
      { $set: { tenantId, characterId: character._id, enabled: true, age: item.age, bio: item.bio, location: item.location, interests: [...item.interests], photos: [] }, $setOnInsert: { createdAt: new Date(Date.now() - index * 60_000) } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    await MatchReaction.findOneAndUpdate(
      { tenantId, fromProfileId: character._id, toProfileId: target._id },
      { $set: { type: 'like' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  console.log(`${profiles.length} perfis de demonstração curtiram @${targetUsername} em ${tenantSlug} (${database}).`);
} catch (error) {
  console.error('Não foi possível preparar as curtidas de demonstração:', error instanceof Error ? error.message : 'erro desconhecido');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
