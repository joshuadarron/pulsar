import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Side-effect module: import this FIRST in any scraper entrypoint so the
// project-root .env populates process.env before @pulsar/shared/config/env
// is evaluated. ESM evaluates imports in textual order, so this works only
// if the importing file lists this side-effect import above
// `import { env } from '@pulsar/shared/config/env'`.
dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../../.env') });
