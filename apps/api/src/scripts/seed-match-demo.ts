import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';
import mongoose from 'mongoose';
import { Community } from '../models/Community.js';
import { Account, Character } from '../models/Social.js';
import { MatchProfile, MatchReaction } from '../models/Match.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

if (process.env.NODE_ENV !== 'development') {
  console.error('Seed bloqueado: defina NODE_ENV=development para usar perfis de demonstração.');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI é necessário.');
  process.exit(1);
}

const database = process.env.VYBE_DEV_DB_NAME || 'vybe_dev';
const tenantSlug = process.env.VYBE_MATCH_DEMO_TENANT || 'community';
const hashPassword = () => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(randomBytes(32).toString('hex'), salt, 64).toString('hex')}`;
};

const profiles = [
  { username: 'match.ana', name: 'Ana Luiza', age: 22, bio: 'Entre cafés, fotografia e conversas que se estendem.', location: 'Centro', interests: ['Fotografia', 'Café', 'Música'] },
  { username: 'match.caio', name: 'Caio Ribeiro', age: 24, bio: 'Gosto de conhecer lugares novos e dividir boas playlists.', location: 'Jardim das Artes', interests: ['Música', 'Cinema', 'Viagens'] },
  { username: 'match.beatriz', name: 'Beatriz Ferreira', age: 21, bio: 'Acredito que todo dia fica melhor com arte e boas companhias.', location: 'Vila Nova', interests: ['Arte', 'Livros', 'Fotografia'] },
  { username: 'match.guilherme', name: 'Guilherme Azevedo', age: 26, bio: 'Trilhas no fim de semana e histórias para contar depois.', location: 'Parque Norte', interests: ['Trilhas', 'Culinária', 'Cinema'] },
  { username: 'match.nina', name: 'Nina Costa', age: 23, bio: 'Coleciono pequenos momentos, plantas e recomendações de livros.', location: 'Centro', interests: ['Leitura', 'Plantas', 'Café'] },
  { username: 'match.leonardo', name: 'Leonardo Cardoso', age: 27, bio: 'Música ao vivo, comida boa e uma conversa sem pressa.', location: 'Jardim das Artes', interests: ['Música', 'Culinária', 'Shows'] },
  { username: 'match.mariajulia', name: 'Maria Júlia Alves', age: 22, bio: 'Sempre pronta para descobrir um cantinho novo na cidade.', location: 'Vila Nova', interests: ['Viagens', 'Fotografia', 'Dança'] },
  { username: 'match.rafael', name: 'Rafael Lima', age: 25, bio: 'Faço esporte de manhã e procuro o melhor café à tarde.', location: 'Parque Norte', interests: ['Corrida', 'Café', 'Cinema'] },
  { username: 'match.eduarda', name: 'Eduarda Silva', age: 24, bio: 'Gosto de cozinhar para amigos e descobrir bandas novas.', location: 'Centro', interests: ['Culinária', 'Música', 'Livros'] },
  { username: 'match.enzo', name: 'Enzo Martins', age: 28, bio: 'Um bom passeio e uma boa conversa são meu tipo de programa.', location: 'Jardim das Artes', interests: ['Ciclismo', 'Viagens', 'Fotografia'] },
  { username: 'match.isabela', name: 'Isabela Mendes', age: 21, bio: 'Entre aulas, exposições e planos para a próxima viagem.', location: 'Vila Nova', interests: ['Arte', 'Viagens', 'Dança'] },
  { username: 'match.vitor', name: 'Vitor Nunes', age: 29, bio: 'Músico nas horas vagas e explorador de restaurantes por vocação.', location: 'Parque Norte', interests: ['Música', 'Culinária', 'Shows'] },
  { username: 'match.lara', name: 'Lara Oliveira', age: 23, bio: 'Gosto de fotografia analógica, cafés tranquilos e boas conversas.', location: 'Centro', interests: ['Fotografia', 'Café', 'Livros'] },
  { username: 'match.davi', name: 'Davi Carvalho', age: 26, bio: 'Entre uma partida de vôlei e outra, sempre cabe um passeio novo.', location: 'Parque Norte', interests: ['Vôlei', 'Cinema', 'Viagens'] },
  { username: 'match.julia', name: 'Júlia Barros', age: 22, bio: 'Curiosa por arte, música ao vivo e lugares diferentes para conhecer.', location: 'Vila Nova', interests: ['Arte', 'Shows', 'Culinária'] },
  { username: 'match.mateus', name: 'Mateus Moreira', age: 28, bio: 'Cozinho para relaxar e adoro descobrir trilhas perto da cidade.', location: 'Jardim das Artes', interests: ['Culinária', 'Trilhas', 'Música'] },
  { username: 'match.luana', name: 'Luana Ribeiro', age: 24, bio: 'Meu plano favorito mistura natureza, amigos e uma playlist boa.', location: 'Centro', interests: ['Natureza', 'Música', 'Fotografia'] },
] as const;

try {
  await mongoose.connect(uri, { dbName: database, autoIndex: false });
  const tenant = await Community.findOne({ slug: tenantSlug }).select('_id').lean();
  if (!tenant) throw new Error(`Comunidade de demonstração "${tenantSlug}" não encontrada no banco ${database}.`);
  const tenantId = (tenant as unknown as { _id: mongoose.Types.ObjectId })._id;

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
  }

  const nina = await Character.findOne({ tenantId, username: 'match.nina' }).select('_id').lean();
  if (nina) {
    // Reabrir Nina na descoberta, limpando apenas os descartes; likes, matches e bloqueios permanecem intactos.
    await MatchReaction.deleteMany({ tenantId, toProfileId: nina._id, type: 'pass' });
  }

  console.log(`Seed Match concluído no banco ${database}: ${profiles.length} perfis independentes habilitados em ${tenantSlug}; Nina Costa reaberta para descoberta após limpar descartes.`);
} catch (error) {
  console.error('Falha ao criar perfis de demonstração do Match:', error instanceof Error ? error.message : 'erro desconhecido');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
