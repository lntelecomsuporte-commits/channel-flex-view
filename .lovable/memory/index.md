# Memory: index.md
Updated: today

# Project Memory

## Core
PWA for Smart TVs/Mobile. Tech: Supabase, Capacitor, Flussonic.
Brand: "LN TV", dark mode, primary red #dc2626.
Player: 100vw/100vh, object-contain. HLS/MP4 only.
Auth: No public sign-up. Global session revocation on block.
**Production = self-hosted at tv2.lntelecom.net.** Cloud (tv.lntelecom.net) is ONLY the AI edit workspace; user pulls changes to local. After every change, give sync procedure. NEVER make self-hosted fetch URLs/.env/secrets from Cloud — see [self-hosted deployment](mem://deployment/self-hosted).

## Memories
- [Self-hosted deployment](mem://deployment/self-hosted) — tv2 sync procedure, exceptions (URL/.env/kong/DB)
- [Player & Navigation](mem://features/player) — Remote/touch controls, autoplay rules, Airplay support
- [Hubsoft Integration](mem://features/hubsoft-integration) — Webhooks, TVLN filtering, CPF login generation, blocking logic
- [Auth & Users](mem://features/auth-users) — Plaintext passwords for ERP, REST API for Auth, user_roles
- [EPG System](mem://features/epg) — OSD, timeline grid, epg-proxy, timezone -3
- [Categories](mem://features/categories) — Hierarchical inclusion and dynamic access resolution
- [Proxies](mem://architecture/proxies) — hls-proxy for mixed content/CORS fallback
- [UI & Styling](mem://design/ui) — Scroll locks, overlay layout, branding assets
- [Project Setup](mem://project/setup) — PWA configuration and environments
