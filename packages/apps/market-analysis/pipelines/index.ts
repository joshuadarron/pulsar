// ---------------------------------------------------------------------------
// Pipeline file location export
//
// `.pipe` files are JSON RocketRide pipeline definitions. They live next to
// this index module so that resolving the directory at runtime is a single
// `path.dirname(import.meta.url)` call regardless of where the consumer
// imports from. The runner reads `.pipe` files via `fs.readFile` against
// `path.join(pipelinesDir, '<name>.pipe')`.
//
// Pipeline inventory:
//   trend-report.pipe       Market analysis trend report (multi-pass).
//   angle-picker.pipe       Phase 5 pass 1 of content generation. Picks
//                           angles + platforms from a completed report.
//   content-drafter.pipe    Phase 5 pass 2 of content generation. Writes
//                           drafts for the platforms each angle selected.
//   retrospective.pipe      Weekly retrospective.
//   evaluation.pipe         Output evaluation pipeline.
//
// Phase 5 replaced the legacy `content-drafts.pipe` (single all-platform
// generator) with the angle-picker / content-drafter pair. Old file
// deleted; the runner now invokes the two new pipes sequentially.
// ---------------------------------------------------------------------------

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pipelinesDir = path.dirname(fileURLToPath(import.meta.url));
