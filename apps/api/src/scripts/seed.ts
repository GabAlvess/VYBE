import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';
import mongoose from 'mongoose';
import { Community } from '../models/Community.js';
import { CommunityRequest } from '../models/CommunityRequest.js';
import { Account, Character, Comment, CommunityEvent, EventRSVP, Follow, Like, Notification, Post, Session } from '../models/Social.js';
import { CommunityChannel, CommunityMessage, CommunityMessageReport, DirectMessage } from '../models/Chat.js';

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

const tenantSlug = 'community';
const tenantHost = 'community.vybe.com.br';
const developmentDatabase = process.env.VYBE_DEV_DB_NAME || 'vybe_dev';
const demoPassword = process.env.VYBE_DEMO_PASSWORD || 'VybeDemo!2026';
const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};

const demoCharacters = [
  ['yasminmv', 'Yasmin Monteiro', 'Estudante de artes cênicas. Sempre pronta para a próxima história.'],
  ['livia.monteiro', 'Lívia Monteiro', 'Coleciona livros antigos e momentos improváveis.'],
  ['caio.ribeiro', 'Caio Ribeiro', 'Debatedor por natureza, curioso por escolha.'],
  ['marinaduarte', 'Marina Duarte', 'Entre a música, os mistérios e os cafés demorados.'],
  ['hvalen', 'Henrique Valen', 'Novato em Bellmont, veterano em boas perguntas.'],
  ['sofalmeida', 'Sofia Almeida', 'Fotógrafa amadora e observadora profissional.'],
  ['clara.snts', 'Clara Santos', 'Acredita que toda cidade tem uma história escondida.'],
  ['marcelo.rp', 'Marcelo Rocha', 'Faz mapas, playlists e planos que nunca seguem o mapa.'],
  ['isabelecruz', 'Isabel Cruz', 'Pesquisadora de lendas locais e histórias esquecidas.'],
  ['lucasferrari', 'Lucas Ferrari', 'Atleta, músico e frequentador da biblioteca à noite.'],
  ['prof.ravi', 'Ravi Nascimento', 'Professor de história. Curador de enigmas nas horas vagas.'],
  ['diretoriabm', 'Diretoria Bellmont', 'Avisos, novidades e comunicados oficiais da comunidade.'],
] as const;

const demoPosts = [
  { key: 'welcome-yasmin', author: 'yasminmv', content: 'As portas da Universidade Bellmont estão abertas. Qual vai ser a primeira história que vamos viver por aqui? 💜', imageUrl: '/community-worlds.png', kind: 'post' as const },
  { key: 'livia-campus', author: 'livia.monteiro', content: 'Mais um dia nesse universo que eu escolhi viver. 💜', imageUrl: '/community-worlds.png', kind: 'post' as const },
  { key: 'caio-question', author: 'caio.ribeiro', content: 'Discussão incrível na aula de hoje. Quem aí também acha que o caso pode ter mais de uma interpretação?', imageUrl: '', kind: 'post' as const },
  { key: 'marina-library', author: 'marinaduarte', content: 'Encontrei uma anotação escondida na biblioteca antiga. A letra parece ser de alguém que ainda estuda aqui…', imageUrl: '/community-worlds.png', kind: 'post' as const },
  { key: 'henrique-pulse', author: 'hvalen', content: 'Primeira semana em Bellmont: 3 cafés, 2 corredores errados e uma amizade nova.', imageUrl: '', kind: 'pulse' as const },
  { key: 'sofia-photo', author: 'sofalmeida', content: 'O campus fica ainda mais bonito quando a cidade começa a acender as luzes.', imageUrl: '/community-worlds.png', kind: 'post' as const },
  { key: 'clara-pulse', author: 'clara.snts', content: 'Qual lenda de Bellmont vocês gostariam de investigar primeiro?', imageUrl: '', kind: 'pulse' as const },
  { key: 'marcelo-map', author: 'marcelo.rp', content: 'Atualizei o mapa do campus com os caminhos secretos que descobrimos esta semana.', imageUrl: '/community-worlds.png', kind: 'post' as const },
  { key: 'isabel-archive', author: 'isabelecruz', content: 'O arquivo municipal guarda uma referência à fundação da universidade. Amanhã vou atrás da fonte original.', imageUrl: '', kind: 'post' as const },
  { key: 'ravi-announcement', author: 'prof.ravi', content: 'Lembrete: a sala de estudos do prédio norte fica aberta até mais tarde durante a semana de provas.', imageUrl: '', kind: 'post' as const },
  { key: 'bellmont-event', author: 'diretoriabm', content: 'A Semana Acadêmica já tem data! Salvem o dia e compartilhem suas ideias para a programação.', imageUrl: '/community-worlds.png', kind: 'post' as const },
  { key: 'yasmin-pulse', author: 'yasminmv', content: 'Às vezes, um novo capítulo começa com um simples “oi”.', imageUrl: '', kind: 'pulse' as const },
];

try {
  await mongoose.connect(uri, { dbName: developmentDatabase, autoIndex: false });

  const models = [Community, CommunityRequest, Account, Character, Session, Post, Like, Comment, Follow, Notification, CommunityEvent, EventRSVP, CommunityChannel, CommunityMessage, CommunityMessageReport, DirectMessage];
  for (const model of models) {
    const exists = await mongoose.connection.db!.listCollections({ name: model.collection.collectionName }).hasNext();
    if (!exists) continue;
    const indexes = await model.collection.listIndexes().toArray();
    for (const index of indexes) {
      if (index.sparse && index.key.tenantId === 1 && index.key.seedKey === 1 && typeof index.name === 'string') {
        await model.collection.dropIndex(index.name);
      }
    }
  }
  for (const model of models) await model.createIndexes();

  const tenant = await Community.findOneAndUpdate(
    { slug: tenantSlug },
    { $set: {
      name: 'VYBE Community', slug: tenantSlug, subdomain: tenantSlug,
      description: 'A comunidade oficial do VYBE. Um espaço para conhecer a plataforma, explorar recursos, testar personagens e acompanhar novidades.',
      type: 'public', entry: 'open', status: 'active',
      brand: { primary: '#16815D', dark: '#0D6248', medium: '#35A67A', soft: '#F2FAF6', lilac: '#DDF3EA', white: '#FFFFFF', graphite: '#1F2422' },
      rules: ['Respeite os outros personagens e suas histórias.', 'Mantenha as interações dentro das regras da comunidade.', 'Use os canais adequados para dúvidas e sugestões.'],
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const accountEmail = 'demo@community.vybe.test';
  let account = await Account.findOne({ tenantId: tenant._id, email: accountEmail });
  if (!account) account = await Account.create({ tenantId: tenant._id, email: accountEmail, passwordHash: hashPassword(demoPassword), status: 'active' });
  await Community.updateOne({ _id: tenant._id }, { $set: { admins: [account._id], ownerAccountId: account._id, ownerEmail: account.email } });

  const characters = new Map<string, mongoose.Types.ObjectId>();
  for (const [username, displayName, bio] of demoCharacters) {
    const character = await Character.findOneAndUpdate(
      { tenantId: tenant._id, username },
      { $set: { accountId: account._id, username, displayName, bio }, $setOnInsert: { avatarUrl: '', coverUrl: '', followerCount: 0, followingCount: 0, postCount: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    characters.set(username, character._id);
  }

  const channelSeeds = [
    ['geral', 'Geral', 'Conversa aberta da comunidade.', 'text', 'members'],
    ['apresentacoes', 'Geral', 'Conte um pouco sobre seu personagem.', 'text', 'members'],
    ['conversa-livre', 'Geral', 'Assuntos e encontros do dia a dia.', 'text', 'members'],
    ['praca-central', 'Roleplay', 'Um ponto de encontro no coração da cidade.', 'roleplay', 'members'],
    ['universidade', 'Roleplay', 'Cenas e histórias no campus.', 'roleplay', 'members'],
    ['avisos', 'Comunidade', 'Comunicados oficiais da comunidade.', 'announcement', 'staff'],
    ['ajuda', 'Comunidade', 'Dúvidas e apoio entre personagens.', 'text', 'members'],
  ] as const;
  const channelIds = new Map<string, mongoose.Types.ObjectId>();
  for (const [name, category, description, kind, posting] of channelSeeds) {
    const channel = await CommunityChannel.findOneAndUpdate({ tenantId: tenant._id, name }, { $set: { tenantId: tenant._id, name, category, description, kind, posting, private: false }, $setOnInsert: { createdBy: null } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    channelIds.set(name, channel._id);
  }
  const chatSeed = [
    ['welcome-general', 'geral', 'yasminmv', 'Bem-vindos à VYBE Community! Que histórias vamos criar juntos?'],
    ['reply-general', 'geral', 'caio.ribeiro', 'Já estou reunindo ideias para a primeira conversa.'],
    ['intro-marina', 'apresentacoes', 'marinaduarte', 'Oi, pessoal! Gosto de música, mistérios e cafés demorados.'],
    ['rp-square', 'praca-central', 'livia.monteiro', 'A praça está cheia hoje. Alguém mais ouviu música vindo do coreto?'],
    ['notice-week', 'avisos', 'diretoriabm', 'A Semana Acadêmica está chegando. Em breve compartilharemos a programação.'],
  ] as const;
  for (const [seedKey, channelName, author, content] of chatSeed) {
    await CommunityMessage.updateOne({ tenantId: tenant._id, seedKey }, { $setOnInsert: { tenantId: tenant._id, channelId: channelIds.get(channelName)!, characterId: characters.get(author)!, content, seedKey } }, { upsert: true });
  }

  const posts = new Map<string, mongoose.Types.ObjectId>();
  for (const [index, demoPost] of demoPosts.entries()) {
    const post = await Post.findOneAndUpdate(
      { tenantId: tenant._id, seedKey: demoPost.key },
      { $set: { tenantId: tenant._id, characterId: characters.get(demoPost.author)!, content: demoPost.content, imageUrl: demoPost.imageUrl, kind: demoPost.kind }, $setOnInsert: { likesCount: 0, commentsCount: 0, createdAt: new Date(Date.now() - (demoPosts.length - index) * 3600_000) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    posts.set(demoPost.key, post._id);
  }

  const follows = [
    ['yasminmv', 'livia.monteiro'], ['yasminmv', 'marinaduarte'], ['livia.monteiro', 'yasminmv'], ['caio.ribeiro', 'livia.monteiro'],
    ['marinaduarte', 'sofalmeida'], ['hvalen', 'caio.ribeiro'], ['sofalmeida', 'yasminmv'], ['clara.snts', 'isabelecruz'],
    ['marcelo.rp', 'lucasferrari'], ['lucasferrari', 'marcelo.rp'], ['yasminmv', 'clara.snts'], ['prof.ravi', 'diretoriabm'],
  ];
  for (const [follower, followed] of follows) await Follow.updateOne({ tenantId: tenant._id, followerId: characters.get(follower)!, followedId: characters.get(followed)! }, { $setOnInsert: { tenantId: tenant._id, followerId: characters.get(follower)!, followedId: characters.get(followed)! } }, { upsert: true });

  const likes = [
    ['livia.monteiro', 'welcome-yasmin'], ['caio.ribeiro', 'welcome-yasmin'], ['marinaduarte', 'welcome-yasmin'], ['yasminmv', 'caio-question'],
    ['sofalmeida', 'caio-question'], ['hvalen', 'livia-campus'], ['clara.snts', 'livia-campus'], ['marcelo.rp', 'marina-library'],
    ['isabelecruz', 'marina-library'], ['prof.ravi', 'sofia-photo'], ['diretoriabm', 'welcome-yasmin'], ['yasminmv', 'bellmont-event'],
  ];
  for (const [liker, postKey] of likes) await Like.updateOne({ tenantId: tenant._id, characterId: characters.get(liker)!, postId: posts.get(postKey)! }, { $setOnInsert: { tenantId: tenant._id, characterId: characters.get(liker)!, postId: posts.get(postKey)! } }, { upsert: true });

  const demoComments = [
    ['comment-welcome-1', 'welcome-yasmin', 'livia.monteiro', 'Já estou preparando meu personagem! Que comece a aventura.'],
    ['comment-welcome-2', 'welcome-yasmin', 'caio.ribeiro', 'Quero descobrir todos os mistérios desse campus.'],
    ['comment-campus-1', 'livia-campus', 'yasminmv', 'E a melhor companhia também. 💜'],
    ['comment-caio-1', 'caio-question', 'marcelo.rp', 'Acho que ainda falta uma pista importante.'],
    ['comment-photo-1', 'sofia-photo', 'marinaduarte', 'Essa luz ficou incrível!'],
    ['comment-event-1', 'bellmont-event', 'hvalen', 'Podemos ter uma noite de jogos na programação?'],
  ];
  for (const [seedKey, postKey, author, content] of demoComments) await Comment.updateOne({ tenantId: tenant._id, seedKey }, { $set: { tenantId: tenant._id, postId: posts.get(postKey)!, characterId: characters.get(author)!, content }, $setOnInsert: { seedKey } }, { upsert: true });

  const noticeRows = [
    ['notice-follow-yasmin', 'yasminmv', 'marinaduarte', 'follow', 'marinaduarte'],
    ['notice-like-yasmin', 'yasminmv', 'livia.monteiro', 'like', 'welcome-yasmin'],
    ['notice-comment-yasmin', 'yasminmv', 'caio.ribeiro', 'comment', 'welcome-yasmin'],
  ] as const;
  for (const [seedKey, recipient, actor, type, target] of noticeRows) await Notification.updateOne({ tenantId: tenant._id, seedKey }, { $set: { tenantId: tenant._id, characterId: characters.get(recipient)!, actorId: characters.get(actor)!, type, targetId: posts.get(target) ?? characters.get(target)! }, $setOnInsert: { seedKey } }, { upsert: true });

  const eventRows = [
    ['event-academic-week', 'Semana Acadêmica', 'Encontros, oficinas e apresentações para toda a comunidade.', 7, 'Auditório Principal · Bellmont'],
    ['event-library-night', 'Noite na Biblioteca', 'Uma noite de leitura, enigmas e histórias compartilhadas.', 14, 'Biblioteca Central'],
    ['event-welcome', 'Boas-vindas aos novos personagens', 'Um encontro para conhecer a comunidade e começar novas histórias.', 21, 'Jardim interno'],
  ] as const;
  for (const [seedKey, title, description, days, location] of eventRows) await CommunityEvent.updateOne({ tenantId: tenant._id, seedKey }, { $set: { tenantId: tenant._id, title, description, startsAt: new Date(Date.now() + days * 86400_000), location, status: 'upcoming', imageUrl: '/community-worlds.png' }, $setOnInsert: { seedKey } }, { upsert: true });

  for (const characterId of characters.values()) {
    const [followerCount, followingCount, postCount] = await Promise.all([
      Follow.countDocuments({ tenantId: tenant._id, followedId: characterId }),
      Follow.countDocuments({ tenantId: tenant._id, followerId: characterId }),
      Post.countDocuments({ tenantId: tenant._id, characterId }),
    ]);
    await Character.updateOne({ _id: characterId, tenantId: tenant._id }, { $set: { followerCount, followingCount, postCount } });
  }
  for (const postId of posts.values()) {
    const [likesCount, commentsCount] = await Promise.all([
      Like.countDocuments({ tenantId: tenant._id, postId }),
      Comment.countDocuments({ tenantId: tenant._id, postId }),
    ]);
    await Post.updateOne({ _id: postId, tenantId: tenant._id }, { $set: { likesCount, commentsCount } });
  }
  const memberCount = await Account.countDocuments({ tenantId: tenant._id, status: 'active' });
  await Community.updateOne({ _id: tenant._id }, { $set: { memberCount } });

  console.log(`Seed pronto no banco ${developmentDatabase}.`);
  console.log(`Tenant: ${tenantHost} | ${characters.size} personagens | ${posts.size} publicações | ${eventRows.length} eventos.`);
  console.log(`Conta de demonstração: ${accountEmail} | senha definida por VYBE_DEMO_PASSWORD ou o padrão documentado para desenvolvimento.`);
} catch (error) {
  console.error('Falha ao criar seed de desenvolvimento:', error instanceof Error ? error.message : 'erro desconhecido');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
