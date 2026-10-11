import { createServer } from 'http';
import app from './server.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const server = createServer(app);

server.listen(PORT, () => {
  console.log(`A11yFix backend running on http://localhost:${PORT}`);
  console.log(`Health check: GET http://localhost:${PORT}/api/health`);
});
