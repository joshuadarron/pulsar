// ---------------------------------------------------------------------------
// Pipeline file location export
//
// `.pipe` files are JSON RocketRide pipeline definitions. They live next to
// this index module so that resolving the directory at runtime is a single
// `path.dirname(import.meta.url)` call regardless of where the consumer
// imports from. The runner reads `.pipe` files via `fs.readFile` against
// `path.join(pipelinesDir, '<name>.pipe')`.
// ---------------------------------------------------------------------------

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pipelinesDir = path.dirname(fileURLToPath(import.meta.url));
