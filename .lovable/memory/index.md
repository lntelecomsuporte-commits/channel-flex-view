# Project Memory

## Core
PWA for Smart TVs/Mobile. 100% self-hosted (Supabase em /opt/lntv, frontend /opt/lntv-frontend → /var/www/lntv, nginx tv2.lntelecom.net).
PROIBIDO apontar pro Supabase Cloud (*.supabase.co) — proxies SEMPRE no origin do site, fallback hardcoded https://tv2.lntelecom.net (PRODUCTION_HOST em src/lib/stream.ts).
Brand: "LN TV", dark mode, primary red #dc2626.
Player: 100vw/100vh, object-contain. HLS/MP4 only.
Auth: No public sign-up. Global session revocation on block.
Logos: nginx serve /logos/ → /opt/lntv-frontend/public/logos/. Cron sync-logos a cada 5min.
Build prod: cd /opt/lntv-frontend && npm run build && rsync -a --delete --exclude logos dist/ /var/www/lntv/
SEMPRE ao final de QUALQUER mudança (frontend, edge function, migration), incluir bloco bash com os comandos exatos pro user rodar no servidor self-hosted. Nunca omitir. Ver mem://deployment/self-hosted.

## Memories
- [Self-hosted deployment](mem://deployment/self-hosted) — Procedimento de sync obrigatório após cada mudança
- [No Cloud constraint](mem://constraints/no-cloud) — Tudo local, proxies no mesmo domínio, regras de build
- [Player & Navigation](mem://features/player) — Remote/touch controls, autoplay rules, Airplay support
- [Hubsoft Integration](mem://features/hubsoft-integration) — Webhooks, TVLN filtering, CPF login generation, blocking logic
- [Auth & Users](mem://features/auth-users) — Plaintext passwords for ERP, REST API for Auth, user_roles
- [EPG System](mem://features/epg) — OSD, timeline grid, epg-proxy, timezone -3
- [Categories](mem://features/categories) — Hierarchical inclusion and dynamic access resolution
- [Proxies](mem://architecture/proxies) — hls-proxy for mixed content/CORS fallback
- [UI & Styling](mem://design/ui) — Scroll locks, overlay layout, branding assets
- [Project Setup](mem://project/setup) — PWA configuration and environments
