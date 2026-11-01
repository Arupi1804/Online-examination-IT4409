import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Import this before anything else: ESM evaluates every import before the
// importing module's body, and Prisma reads DATABASE_URL while being imported.
// Without a .env file (Docker, CI) existing variables are kept.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });
