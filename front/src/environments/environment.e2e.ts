// Same shape as environment.ts (dev) but pointing at the isolated stack.
// - apiUrl is RELATIVE so the dev-server's proxy (proxy.e2e.conf.json)
//   rewrites /api → http://localhost:18080 — avoids CORS that would
//   trigger on an absolute http://localhost:18080/api URL.
// - wsUrl is absolute (no proxy for WS in ng dev-server) so it points
//   directly at duel-server on :13001.
export const environment = {
  production: false,
  debugTools: true,
  apiUrl: '/api',
  wsUrl: 'ws://localhost:13001',
};
