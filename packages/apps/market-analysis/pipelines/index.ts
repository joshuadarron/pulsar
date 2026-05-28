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
//   article-picker.pipe     Article-package pass 1. Picks article specs
//                           from a completed report, applying metaphor
//                           rotation + Medium queue avoidance.
//   article-writer.pipe     Article-package pass 2. Writes the article
//                           body for one spec at a time.
//   article-annotator.pipe  Article-package pass 3. Emits the three
//                           companion markdown files (quotes, images,
//                           publications) grounded on the finalized body.
//   angle-picker.pipe       (Deprecated) Phase 5 pass 1 of multi-platform
//                           content drafts. Retained for legacy reports.
//   content-drafter.pipe    (Deprecated) Phase 5 pass 2 of multi-platform
//                           content drafts. Retained for legacy reports.
//   retrospective.pipe      Weekly retrospective.
//   evaluation.pipe         Output evaluation pipeline.
//
// The article-picker / article-writer / article-annotator triple supersedes
// the angle-picker / content-drafter pair. The new path produces one
// four-file article package per opportunity (content, quotes, images,
// publications) plus series-level state (metaphor rotation, Medium queue,
// cross-references). The old pipes stay so prior reports keep rendering
// their content_drafts rows; new runs write content_articles rows instead.
// ---------------------------------------------------------------------------

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pipelinesDir = path.dirname(fileURLToPath(import.meta.url));
