# Project Memory

## Core
PWA for Smart TVs/Mobile. Tech: Supabase, Capacitor, Flussonic.
Brand: "LN TV", dark mode, primary red #dc2626.
Player: 100vw/100vh, object-contain. HLS/MP4 only.
Auth: No public sign-up. Global session revocation on block.
Domain: Cloud=tv.lntelecom.net (dev only), Production=tv2.lntelecom.net (self-hosted).
ALWAYS end every change with the self-hosted sync commands displayed on screen. Never skip. Commands: cd /opt/lntv-frontend && git fetch origin && git reset --hard origin/main && npm run build:local

## Memories
- [Self-hosted deployment](mem://deployment/self-hosted) — Sync procedure for tv2.lntelecom.net after every Cloud change
- [Player & Navigation](mem://features/player) — Remote/touch controls, autoplay rules, Airplay support
- [Hubsoft Integration](mem://features/hubsoft-integration) — Webhooks, TVLN filtering, CPF login generation, blocking logic
- [Auth & Users](mem://features/auth-users) — Plaintext passwords for ERP, REST API for Auth, user_roles
- [EPG System](mem://features/epg) — OSD, timeline grid, epg-proxy, timezone -3
- [Categories](mem://features/categories) — Hierarchical inclusion and dynamic access resolution
- [Proxies](mem://architecture/proxies) — hls-proxy for mixed content/CORS fallback
- [UI & Styling](mem://design/ui) — Scroll locks, overlay layout, branding assets
- [Project Setup](mem://project/setup) — PWA configuration and environments
