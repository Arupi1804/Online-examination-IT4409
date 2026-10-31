import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Server } from 'socket.io';
import { z } from 'zod';
import { ERROR_CODES, WS_NAMESPACE } from '@online-exam/shared';
import { createApp } from './app.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const env = z
  .object({
    SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  })
  .parse(process.env);
const server = createServer(createApp(env.CLIENT_ORIGIN));
const io = new Server(server, {
  cors: { origin: env.CLIENT_ORIGIN, credentials: true },
});
// Fail closed until TV1 + TV3 implement shared Redis session authentication.
io.of(WS_NAMESPACE).use((_socket, next) => {
  const error = new Error(ERROR_CODES.AUTH_SESSION_EXPIRED);
  Object.assign(error, { data: { code: ERROR_CODES.AUTH_SESSION_EXPIRED } });
  next(error);
});
server.listen(env.SERVER_PORT, '0.0.0.0', () =>
  console.log(`API listening on ${env.SERVER_PORT}`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    io.close();
    server.close();
  });
}
