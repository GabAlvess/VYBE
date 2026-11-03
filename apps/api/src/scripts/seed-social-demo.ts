import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Community } from '../models/Community.js';
import { Account, Character, Like, Post } from '../models/Social.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

if (process.env.NODE_ENV !== 'development') {
  console.error('Seed bloqueado: defina NODE_ENV=development para usar dados de demonstração.');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI é necessário.');
  process.exit(1);
}

const database = process.env.VYBE_DEV_DB_NAME || 'vybe_dev';
const demoAccountEmail = 'demo@community.vybe.test';

const extraCharacters = [
  ['ana.luiza', 'Ana Luiza', 'Entre livros, cafés e boas conversas.'],
  ['pedro.moraes', 'Pedro Moraes', 'Sempre procurando um lugar novo para conhecer.'],
  ['biaferreira', 'Beatriz Ferreira', 'Fotografia, música e tardes no campus.'],
  ['gui.azevedo', 'Guilherme Azevedo', 'Colecionador de histórias e playlists.'],
  ['nina.costa', 'Nina Costa', 'Um pouco de arte em cada dia.'],
  ['leo.cardoso', 'Leonardo Cardoso', 'Café forte e ideias novas.'],
  ['maju.alves', 'Maria Júlia Alves', 'A melhor parte é dividir os momentos.'],
  ['rafael.lima', 'Rafael Lima', 'Explorando a comunidade com curiosidade.'],
  ['duda.silva', 'Eduarda Silva', 'Gosto de registrar os pequenos detalhes.'],
  ['enzo.martins', 'Enzo Martins', 'Novas amizades sempre rendem boas histórias.'],
  ['isa.mendes', 'Isabela Mendes', 'Entre aulas, encontros e descobertas.'],
  ['vitor.nunes', 'Vitor Nunes', 'Música boa combina com qualquer lugar.'],
  ['carol.pires', 'Carolina Pires', 'Criando memórias por aqui.'],
  ['bruno.ramos', 'Bruno Ramos', 'Curioso por tudo que acontece na cidade.'],
  ['luiza.rocha', 'Luiza Rocha', 'Meu lugar favorito é perto dos amigos.'],
  ['theo.barros', 'Theo Barros', 'Um novo capítulo a cada semana.'],
  ['clara.melo', 'Clara Melo', 'Livros, fotografia e novas conexões.'],
  ['daniel.freitas', 'Daniel Freitas', 'Compartilhando bons momentos.'],
  ['mel.gomes', 'Melissa Gomes', 'Sempre pronta para um passeio depois da aula.'],
  ['andre.farias', 'André Farias', 'A comunidade fica melhor quando todo mundo participa.'],
] as const;

const posts = [
  { key: 'social-demo-cafe', author: 'livia.monteiro', content: 'Pausa para um café e uma conversa que virou a melhor parte do dia. ☕', image: '/vybe-social-friends.png', likes: 30 },
  { key: 'social-demo-campus', author: 'caio.ribeiro', content: 'Fim de tarde no campus. Quem mais gosta de ficar por aqui depois das aulas? 🌇', image: '/bellmont-campus.png', likes: 20 },
  { key: 'social-demo-friends', author: 'marinaduarte', content: 'A gente marca um encontro rápido e acaba criando uma memória para guardar. 💚', image: '/community-worlds.png', likes: 10 },
  { key: 'social-demo-playlist', author: 'sofalmeida', content: 'Qual música não pode faltar na playlist da comunidade? Deixem sugestões 🎧', image: '/community-worlds.png', likes: 8 },
  { key: 'social-demo-week', author: 'hvalen', content: 'Semana cheia, mas sempre cabe um tempinho para conhecer gente nova por aqui.', image: '/bellmont-campus.png', likes: 6 },
  { key: 'social-demo-garden', author: 'clara.snts', content: 'Descobri um cantinho tranquilo para ler entre uma atividade e outra. 📚', image: '/bellmont-campus.png', likes: 4 },
  { key: 'social-demo-art', author: 'ana.luiza', content: 'Pequenos detalhes da rotina também merecem virar lembrança ✨', image: '/vybe-social-friends.png', likes: 3 },
  { key: 'social-demo-weekend', author: 'pedro.moraes', content: 'Ideias para fazer neste fim de semana? Estou aceitando recomendações!', image: '/community-worlds.png', likes: 2 },
] as const;
const savedLikeCounts: number[] = [];

try {
  await mongoose.connect(uri, { dbName: database, autoIndex: false });
  const tenant = await Community.findOne({ slug: 'community' }).select('_id').lean();
  if (!tenant) throw new Error('A comunidade de demonstração "community" não existe neste banco.');
  const tenantId = (tenant as unknown as { _id: mongoose.Types.ObjectId })._id;
  const account = await Account.findOne({ tenantId, email: demoAccountEmail, status: 'active' }).select('_id').lean();
  if (!account) throw new Error('A conta de demonstração não existe. Execute o seed de desenvolvimento primeiro.');
  const accountId = (account as unknown as { _id: mongoose.Types.ObjectId })._id;

  const characters = new Map<string, mongoose.Types.ObjectId>();
  for (const [username, displayName, bio] of extraCharacters) {
    const character = await Character.findOneAndUpdate(
      { tenantId, username },
      { $set: { tenantId, accountId, username, displayName, bio }, $setOnInsert: { avatarUrl: '', coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    characters.set(username, character._id);
  }
  const existingCharacters = await Character.find({ tenantId, accountId }).select('_id username').lean();
  for (const character of existingCharacters) characters.set(character.username, character._id);
  if (characters.size < 31) throw new Error('São necessários ao menos 31 perfis de demonstração para registrar as curtidas solicitadas.');

  for (const [index, item] of posts.entries()) {
    const authorId = characters.get(item.author);
    if (!authorId) throw new Error(`Perfil de demonstração ausente: ${item.author}`);
    const post = await Post.findOneAndUpdate(
      { tenantId, seedKey: item.key },
      { $set: { tenantId, characterId: authorId, content: item.content, imageUrl: item.image, imageUrls: [item.image], kind: 'post', seedKey: item.key }, $setOnInsert: { likesCount: 0, commentsCount: 0, viewsCount: 0, createdAt: new Date(Date.now() - index * 3 * 60 * 60 * 1000) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const likers = [...characters.entries()].filter(([username]) => username !== item.author).slice(0, item.likes);
    for (const [, characterId] of likers) {
      await Like.updateOne({ tenantId, postId: post._id, characterId }, { $setOnInsert: { tenantId, postId: post._id, characterId } }, { upsert: true });
    }
    const likesCount = await Like.countDocuments({ tenantId, postId: post._id });
    await Post.updateOne({ _id: post._id, tenantId }, { $set: { likesCount } });
    savedLikeCounts.push(likesCount);
  }

  for (const characterId of characters.values()) {
    const postCount = await Post.countDocuments({ tenantId, characterId });
    await Character.updateOne({ _id: characterId, tenantId }, { $set: { postCount } });
  }
  console.log(`Seed Social concluído no banco ${database}: ${posts.length} publicações em VYBE Community. Curtidas verificadas: ${savedLikeCounts.join(', ')}.`);
} catch (error) {
  console.error('Falha ao criar publicações de demonstração:', error instanceof Error ? error.message : 'erro desconhecido');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
