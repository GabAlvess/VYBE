import 'dotenv/config';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('MONGODB_URI is required. Configure it in the local .env file.');
  process.exit(1);
}

try {
  await mongoose.connect(uri);
  const database = mongoose.connection.db;

  if (!database) {
    throw new Error('Database connection did not provide a database handle.');
  }

  const existing = await database.listCollections({ name: 'communities' }).toArray();
  if (existing.length === 0) {
    await database.createCollection('communities');
  }

  console.log('Development database initialized with the communities collection.');
} catch {
  console.error('Database initialization failed. Check MongoDB access and network settings.');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
