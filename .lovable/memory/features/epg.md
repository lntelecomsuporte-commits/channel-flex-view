---
name: epg-system
description: EPG self-hosted com cache local via sync-epg.mjs, XML consolidado e fallback no proxy
type: feature
---

# EPG System (LN TV)

## Arquitetura — cache local servido pelo nginx (3h cron)

1. **`scripts/sync-epg.mjs`** roda via cron a cada 3h:
   - Coleta URLs de DUAS fontes (deduplicadas):
     a) `epg_url_presets` (URLs salvas pelo admin)
     b) `channels.epg_url` distintas de canais ativos com `epg_channel_id` (URLs avulsas)
   - Baixa cada XMLTV para `/opt/lntv-frontend/public/epg/sources/<slug>.xml`
   - Lê `public.channels` ativos e gera `/opt/lntv-frontend/public/epg/lntv.xml` (consolidado, só nossos canais)
   - Remove arquivos órfãos (URLs que não existem mais em nenhuma das duas fontes)
   - User-Agent fallback (bot → browser-like) para vencer anti-bot do open-epg
2. **Nginx** serve `/epg/sources/*.xml` e `/epg/lntv.xml` direto do disco — sem CORS, sem proxy.
3. **Frontend** (`useMultiEPG`): sempre tenta `lntv.xml` primeiro (1 fetch leve), e só cai no `epg-proxy` para canais cuja `epg_url` não esteja em `epg_url_presets`.
4. **EpgChannelPicker** (admin): lê `/epg/sources/<slug>.xml` direto pra busca instantânea, sem rate-limit.
5. **`epg-proxy`** continua existindo como fallback para URLs não cadastradas + cache em memória + retry com UA browser.

## Slug de URL → arquivo
Definido em `src/lib/hash.ts` (SHA-1 puro JS) + `src/lib/epgCache.ts` (`urlToSlug`):
`<host_path-truncado>-<sha1[0..8]>.xml`. **Mesma fórmula no Node** (`scripts/sync-epg.mjs`) — nunca quebrar a correspondência.

## Cron sugerido
```cron
0 */3 * * *  cd /opt/lntv-frontend && /usr/bin/node scripts/sync-epg.mjs >> /var/log/lntv-epg-sync.log 2>&1
```

## Regenerar consolidado sem rebaixar fontes
```bash
node scripts/sync-epg.mjs --consolidate
```

## Forçar redownload (ignora cache de 2h30)
```bash
node scripts/sync-epg.mjs --force
```

## Timezone
UI exibe horário local com offset -3 (Brasília). Datas vêm em ISO do parser XMLTV.

## Pasta nginx
```nginx
location /epg/ {
  alias /var/www/lntv/epg/;
  add_header Cache-Control "public, max-age=300";
  types { application/xml xml; }
}
```
