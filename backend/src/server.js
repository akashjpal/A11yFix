import express from 'express';
import { router as scansRouter } from './routes/scans.js';
import { router as fixesRouter } from './routes/fixes.js';
import { router as testsRouter } from './routes/tests.js';

const app = express();
app.use(express.json());

app.use('/api/scans', scansRouter);
app.use('/api/fixes', fixesRouter);
app.use('/api/fixes', testsRouter); // visual-test + tests/generate + tests/run

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
export { app };
