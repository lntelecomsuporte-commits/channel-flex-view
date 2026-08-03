# Novo tipo de EPG: InnovaTV (API JSON)

Adicionar um terceiro tipo de EPG no painel admin, além de "Texto Alternativo" e "XMLTV", para ler a API da InnovaTV:

```text
https://api.innovatv.tv.br/epg/api/epg_list/by_date?date=-2,2&id=<ID>&time_zone=America/Sao_Paulo
```

A API devolve um array JSON de programas com `start_ut`, `stop_ut`, `title`, `desc`, `pg` — verificado nos dois canais informados (BM&C News = `BM&CBM&C News`, Hallo Anime = `hallo anime3`).

## Como fica no painel

No bloco "Configuração de EPG" do cadastro de canal:

- Nova opção no seletor "Tipo de EPG": **InnovaTV (API)**.
- Ao escolher, aparece um único campo: **ID do canal na InnovaTV** (ex.: `BM&CBM&C News`, `hallo anime3`). Sem necessidade de colar a URL inteira — ela é montada automaticamente.
- Um botão "Testar" que consulta a API e mostra os próximos programas encontrados, para conferir se o ID está certo antes de salvar.

## Como o EPG chega nas TVs

O EPG consolidado (`/epg/lntv.xml` e `/epg/lntv.json`, gerado a cada 3h pelo `sync-epg.mjs`) já é a fonte única que Web, APK nativo, Roku e Tizen leem. Os canais InnovaTV entram nesse mesmo arquivo, então **nenhum aplicativo precisa ser alterado ou republicado** — nem APK, nem Roku, nem Samsung.

## Detalhes técnicos

1. **Banco**: nenhuma coluna nova. O tipo fica em `channels.epg_type = 'innovatv'`, o ID em `channels.epg_channel_id`, e `channels.epg_url` guarda a URL base da API (`https://api.innovatv.tv.br/epg/api/epg_list/by_date`) para permitir troca futura de host.

2. **`scripts/sync-epg.mjs`**:
   - Nova função `fetchInnovaChannels()` — canais ativos com `epg_type = 'innovatv'`.
   - Para cada um, GET em `<base>?date=-2,2&id=<epg_channel_id>&time_zone=America/Sao_Paulo` (com `encodeURIComponent` no ID, pois `&` e espaços aparecem nos IDs).
   - Converte cada item para o formato interno: `title`, `start_date` = `new Date(start_ut * 1000).toISOString()`, `desc` (ignorando quando igual ao título), `rating` = `pg` quando diferente de `S/C`.
   - Cacheia o JSON bruto em `public/epg/sources/innovatv-<slug>.json` com a mesma regra de idade (2h30) e respeita `--force`.
   - Injeta os programas em `byChannelStruct` e gera também os `<programme>` XMLTV equivalentes, para que `lntv.xml` e `lntv.json` fiquem consistentes.
   - Inclui um `<channel>` mínimo (display-name + logo) para esses canais.
   - Ajusta a limpeza de órfãos para não apagar os arquivos `.json` das fontes InnovaTV.

3. **`src/pages/AdminPanel.tsx`**: item `innovatv` no seletor, campo de ID + botão de teste, e salvamento gravando `epg_url` com a URL base e limpando `epg_alt_text`.

4. **`src/hooks/useEPG.ts` / `useMultiEPG.ts`**: `getEpgSource` passa a reconhecer `innovatv` (sem fallback de proxy — esses canais só vêm do consolidado). O restante da leitura já funciona porque tudo é indexado por `epg_channel_id`.

5. **`supabase/functions/epg-proxy`**: fallback opcional para quando o consolidado ainda não tiver rodado — aceita `?innovatv=<id>` e devolve o XMLTV convertido. Útil no preview/dev, onde não existe nginx local.
