// Re-export the directive too: Next reads route segment config from the page
// file itself, not from the re-exported default's source module. Without this
// the page renders statically and serves a stale snapshot of /drafts.
export { dynamic } from '@pulsar/app-market-analysis/ui/drafts';
export { default } from '@pulsar/app-market-analysis/ui/drafts';
