// Re-export route segment config too: Next reads `dynamic` from the page file
// itself, not the imported default's source module. Without this the page can
// render statically and serve a stale snapshot.
export { default, dynamic } from '@pulsar/app-market-analysis/ui/drafts/[reportId]';
