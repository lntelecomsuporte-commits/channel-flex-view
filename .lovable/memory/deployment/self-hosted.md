---
name: self-hosted-deployment
description: Self-hosted server at tv2.lntelecom.net mirrors Lovable Cloud (tv.lntelecom.net). Procedure for syncing changes.
type: preference
---

# Self-hosted deployment (tv2.lntelecom.net)

User runs production self-hosted at **tv2.lntelecom.net** but uses **Lovable Cloud (tv.lntelecom.net)** for AI-assisted edits. After EVERY change in Cloud, I MUST give the exact procedure to sync the self-hosted server.

## Server paths
- Frontend repo: `/opt/lntv-frontend`
- Edge functions volume: `/opt/lntv/volumes/functions/<name>/index.ts`
- Kong config: needs path discovery (likely under `/opt/lntv/volumes/api/kong.yml`)
- Container names: `supabase-edge-functions`, `supabase-kong`, `supabase-storage`, etc.

## Standard sync procedure (give to user after every change)

```bash
cd /opt/lntv-frontend
git fetch origin && git reset --hard origin/main

# Frontend changed → rebuild
npm run build   # or: bun run build

# Edge function changed → copy + restart
cp supabase/functions/<name>/index.ts /opt/lntv/volumes/functions/<name>/index.ts
docker restart supabase-edge-functions

# kong.yml changed → restart kong
docker restart supabase-kong

# DB migration → must be applied manually on self-hosted (Cloud auto-applies only to Cloud DB)
```

## Critical exceptions — DO NOT pull from Cloud
These values differ between Cloud and self-hosted; never make self-hosted fetch from Cloud or it breaks:
- **Domain/URL**: Cloud `tv.lntelecom.net` vs Self-hosted `tv2.lntelecom.net`
- **`.env`** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, project ID) — self-hosted has its own Supabase stack
- **`src/integrations/supabase/client.ts`** — auto-generated per environment
- **Supabase secrets** — set independently in each stack
- **Database data** — separate databases; migrations apply DDL but not data
- **Kong config** (`kong.yml`) — self-hosted only; Cloud uses different gateway

## Reminders
- Always tell user which container(s) to restart after a change
- For DB schema changes, remind user to apply migration to self-hosted DB too (psql or supabase CLI)
- Test in incognito (Ctrl+Shift+N) to avoid cached service worker
