import express from 'express';
import { config } from './config.js';
import { webhookRouter } from './routes/webhook.js';
import { initDb } from './state/tracker.js';

const app = express();

// Log all incoming requests
app.use((req, _res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path} from ${req.ip}`);
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Admin: Clear cache endpoint
app.post('/admin/clear-cache', async (_req, res) => {
  const { clearCaseCache } = await import('./state/tracker.js');
  try {
    const result = await clearCaseCache();
    console.log('[ADMIN] Cache cleared:', result);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[ADMIN] Failed to clear cache:', err);
    res.status(500).json({ error: String(err) });
  }
});

// SendGrid webhook route (uses raw body parsing via busboy)
app.use('/webhook', webhookRouter);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function main() {
  console.log('='.repeat(60));
  console.log('CORONA CODE ENFORCEMENT CASE SYNC - Starting up...');
  console.log('='.repeat(60));
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Case Updates: ${config.caseUpdatesEnabled ? 'ENABLED' : 'DISABLED (dry run mode)'}`);
  console.log('-'.repeat(60));

  // Initialize database
  console.log('[DB] Initializing database schema...');
  await initDb();
  console.log('[DB] Database ready');

  app.listen(config.port, () => {
    console.log('-'.repeat(60));
    console.log(`[SERVER] Listening on port ${config.port}`);
    console.log(`[SERVER] Health check: http://localhost:${config.port}/health`);
    console.log(`[SERVER] Webhook: POST http://localhost:${config.port}/webhook/sendgrid`);
    console.log('='.repeat(60));
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
