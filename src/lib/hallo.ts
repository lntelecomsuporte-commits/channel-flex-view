/**
 * Hallo EPG — grade do site https://hallo.tv.br/programacao.php
 *
 * O site não publica XMLTV nem API pública: a grade é HTML renderizado no
 * servidor, mas cada célula de programa traz um JSON completo no atributo
 * data-prog (título, sinopse, categoria, rating, início/fim, canal).
 * Quem raspa é o scripts/sync-epg.mjs no servidor (a cada 3h) — o navegador
 * apenas lê o EPG consolidado (/epg/lntv.json), igual ao fluxo da NXTV.
 *
 * O epg_channel_id é o NOME do canal no site (ex.: "Hallo Anime").
 */
import type { EPGProgram } from "@/hooks/useEPG";
import { getConsolidatedEpgJsonUrl } from "@/lib/epgCache";

export const HALLO_BASE_URL = "https://hallo.tv.br/programacao.php";

/**
 * Consulta a grade Hallo já raspada pelo sync-epg no servidor.
 * O navegador não chama hallo.tv.br diretamente (sem CORS).
 */
export async function fetchHalloPrograms(channelId: string): Promise<EPGProgram[]> {
  const res = await fetch(getConsolidatedEpgJsonUrl(), { cache: "no-cache" });
  if (!res.ok) throw new Error(`EPG sincronizado indisponível (HTTP ${res.status})`);

  const json = await res.json();
  const byChannel = json?.byChannel;
  if (!byChannel || typeof byChannel !== "object") {
    throw new Error("Arquivo de EPG sincronizado em formato inválido");
  }

  const wanted = channelId.trim().toLowerCase();
  const storedId = Object.keys(byChannel).find((id) => id.trim().toLowerCase() === wanted);
  if (!storedId || !Array.isArray(byChannel[storedId])) {
    throw new Error(
      `Canal "${channelId}" está sem grade no último sincronismo. ` +
      `Confira se o nome é exatamente como aparece em hallo.tv.br/programacao.php e rode o sync-epg.`
    );
  }

  return byChannel[storedId] as EPGProgram[];
}
