import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import mongoose from 'mongoose';
import { apiInfo } from '@vybe/shared';
import { resolveTenant } from './middleware/tenant.js';
import { mediaRouter } from './routes/media.js';
import { tenantRouter } from './routes/tenant.js';
import { platformRouter } from './routes/platform.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const app = express();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);
const webOrigin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';

app.disable('x-powered-by');
app.use(cors({ origin: webOrigin }));
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: apiInfo.name, version: apiInfo.version });
});

app.get('/api/ready', (_request, response) => {
  const databaseReady = mongoose.connection.readyState === 1;
  response.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'ready' : 'waiting_for_database',
    database: databaseReady ? 'connected' : 'disconnected',
  });
});

app.use(resolveTenant);
app.use('/media', mediaRouter);
app.use('/api', platformRouter);
app.use('/api', tenantRouter);

const server = app.listen(port, host, () => {
  console.log(`VYBE API listening at http://${host}:${port}`);
});

const mongoUri = process.env.MONGODB_URI;
if (mongoUri) {
  const mongoOptions = process.env.NODE_ENV === 'development'
    ? { dbName: process.env.VYBE_DEV_DB_NAME ?? 'vybe_dev' }
    : {};
  mongoose.connect(mongoUri, mongoOptions).then(
    () => console.log('MongoDB connection established'),
    (error: unknown) => {
      console.error('MongoDB connection failed:', error instanceof Error ? error.message : 'unknown error');
    },
  );
} else {
  console.warn('MONGODB_URI is unset; API is running without database readiness.');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void mongoose.disconnect().finally(() => process.exit(0));
    });
  });
}
