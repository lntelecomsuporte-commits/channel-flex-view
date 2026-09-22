// Config Editor estilo Flussonic: serializa/parseia os canais em blocos de texto
// para edição em lote no Painel Administrativo.

export type ConfigChannel = {
  id: string | null;
  name: string;
  channel_number: number;
  stream_url: string;
  backup_stream_urls: string[];
  logo_url: string | null;
  category_name: string | null;
  is_active: boolean;
  is_adult: boolean;
  epg_type: string | null;
  epg_url: string | null;
  epg_channel_id: string | null;
  epg_alt_text: string | null;
  epg_show_synopsis: boolean;
  epg_grab_logo: boolean;
  use_proxy_token: boolean;
  force_proxy_native: boolean;
  prefer_sw_decoder: boolean;
};

type ChannelRow = {
  id: string;
  name: string;
  channel_number: number;
  stream_url: string;
  backup_stream_urls?: string[] | null;
  logo_url?: string | null;
  logo_source_url?: string | null;
  category_id?: string | null;
  is_active?: boolean | null;
  is_adult?: boolean | null;
  epg_type?: string | null;
  epg_url?: string | null;
  epg_channel_id?: string | null;
  epg_alt_text?: string | null;
  epg_show_synopsis?: boolean | null;
  epg_grab_logo?: boolean | null;
  use_proxy_token?: boolean | null;
  force_proxy_native?: boolean | null;
  prefer_sw_decoder?: boolean | null;
};

const q = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

export const CONFIG_HEADER = `# LN TV — Editor de Configuração de Canais (estilo Flussonic)
#
# Edite em lote e clique em "Salvar Configuração".
# Cada bloco é um canal. Mantenha a linha "id" para editar um canal existente;
# omita o "id" (ou use "id auto;") para criar um canal novo.
# Canais removidos do texto NÃO são apagados do banco — use a lista para excluir.
#
# Campos: id, disabled, input, backup, category, logo, epg_type, epg_id,
#         epg_url, epg_text, synopsis, adult, proxy_token, force_proxy, sw_decoder
`;

export function serializeChannels(
  channels: ChannelRow[],
  categoryNameById: Record<string, string>
): string {
  const blocks = channels.map((c) => {
    const lines: string[] = [];
    lines.push(`channel ${c.channel_number} ${q(c.name)} {`);
    lines.push(`  id ${c.id};`);
    lines.push(`  disabled ${c.is_active === false ? "true" : "false"};`);
    lines.push(`  input ${q(c.stream_url)};`);
    for (const b of c.backup_stream_urls ?? []) {
      if (b?.trim()) lines.push(`  backup ${q(b.trim())};`);
    }
    const cat = c.category_id ? categoryNameById[c.category_id] : null;
    if (cat) lines.push(`  category ${q(cat)};`);
    const logo = c.logo_source_url || c.logo_url;
    if (logo) lines.push(`  logo ${q(logo)};`);
    if (c.epg_type) lines.push(`  epg_type ${c.epg_type};`);
    if (c.epg_channel_id) lines.push(`  epg_id ${q(c.epg_channel_id)};`);
    if (c.epg_url) lines.push(`  epg_url ${q(c.epg_url)};`);
    if (c.epg_alt_text) lines.push(`  epg_text ${q(c.epg_alt_text)};`);
    if (c.epg_show_synopsis) lines.push(`  synopsis true;`);
    if (c.epg_grab_logo) lines.push(`  grab_logo true;`);
    if (c.is_adult) lines.push(`  adult true;`);
    if (c.use_proxy_token) lines.push(`  proxy_token true;`);
    if (c.force_proxy_native) lines.push(`  force_proxy true;`);
    if (c.prefer_sw_decoder) lines.push(`  sw_decoder true;`);
    lines.push(`}`);
    return lines.join("\n");
  });
  return `${CONFIG_HEADER}\n${blocks.join("\n\n")}\n`;
}

export type ParseResult = {
  channels: ConfigChannel[];
  errors: string[];
};

const stripQuotes = (v: string) => {
  const t = v.trim().replace(/;+$/, "").trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1).replace(/\\"/g, '"');
  }
  return t;
};

const isTrue = (v: string) => {
  const t = stripQuotes(v).toLowerCase();
  return t === "" || t === "true" || t === "1" || t === "yes";
};

// Aceita tanto "channel 5 "Nome" {" quanto blocos colados do Flussonic
// ("stream live/xxx {" com "title "005 Nome";").
export function parseChannelConfig(text: string): ParseResult {
  const errors: string[] = [];
  const channels: ConfigChannel[] = [];
  const lines = text.split(/\r?\n/);

  let current: ConfigChannel | null = null;
  let currentLine = 0;
  let flussonicSlug: string | null = null;

  const finish = () => {
    if (!current) return;
    if (!current.name) errors.push(`Linha ${currentLine}: canal sem nome.`);
    else if (!Number.isFinite(current.channel_number) || current.channel_number < 0)
      errors.push(`Linha ${currentLine}: canal "${current.name}" sem número válido.`);
    else if (!current.stream_url)
      errors.push(`Linha ${currentLine}: canal "${current.name}" sem URL de stream (input).`);
    else channels.push(current);
    current = null;
    flussonicSlug = null;
  };

  const blank = (): ConfigChannel => ({
    id: null, name: "", channel_number: NaN, stream_url: "", backup_stream_urls: [],
    logo_url: null, category_name: null, is_active: true, is_adult: false,
    epg_type: null, epg_url: null, epg_channel_id: null, epg_alt_text: null,
    epg_show_synopsis: false, epg_grab_logo: false, use_proxy_token: false,
    force_proxy_native: false, prefer_sw_decoder: false,
  });

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    if (line === "}" || line.startsWith("}")) {
      finish();
      continue;
    }

    const chHeader = line.match(/^channel\s+(\d+)\s+(".*?"|\S+)\s*\{$/i);
    if (chHeader) {
      if (current) finish();
      currentLine = lineNo;
      current = blank();
      current.channel_number = parseInt(chHeader[1], 10);
      current.name = stripQuotes(chHeader[2]);
      continue;
    }

    const flHeader = line.match(/^stream\s+(\S+)\s*\{$/i);
    if (flHeader) {
      if (current) finish();
      currentLine = lineNo;
      current = blank();
      flussonicSlug = flHeader[1];
      continue;
    }

    if (!current) {
      errors.push(`Linha ${lineNo}: conteúdo fora de um bloco de canal.`);
      continue;
    }

    const kv = line.match(/^(\w+)\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let value = kv[2].trim().replace(/;+$/, "").trim();

    switch (key) {
      case "id":
        current.id = /^auto$/i.test(stripQuotes(value)) ? null : stripQuotes(value) || null;
        break;
      case "number":
      case "channel_number":
        current.channel_number = parseInt(stripQuotes(value), 10);
        break;
      case "name":
      case "title": {
        // Flussonic usa title "003 Record HD" — extrai número + nome.
        const t = stripQuotes(value);
        const m = t.match(/^(\d{1,5})\s+(.*)$/);
        if (m && !Number.isFinite(current.channel_number)) {
          current.channel_number = parseInt(m[1], 10);
          current.name = m[2].trim();
        } else {
          current.name = t;
        }
        break;
      }
      case "disabled":
        current.is_active = !isTrue(value);
        break;
      case "enabled":
        current.is_active = isTrue(value);
        break;
      case "input":
      case "stream":
      case "url": {
        // No Flussonic pode vir "input url extras..." sem aspas.
        const v = value.startsWith('"') ? stripQuotes(value) : value.split(/\s+/)[0];
        if (!current.stream_url) current.stream_url = v;
        else current.backup_stream_urls.push(v);
        break;
      }
      case "backup": {
        const v = value.startsWith('"') ? stripQuotes(value) : value.split(/\s+/)[0];
        if (v) current.backup_stream_urls.push(v);
        break;
      }
      case "category":
        current.category_name = stripQuotes(value) || null;
        break;
      case "logo":
        current.logo_url = stripQuotes(value) || null;
        break;
      case "epg_type":
        current.epg_type = stripQuotes(value).toLowerCase() || null;
        break;
      case "epg_id":
      case "epg_channel_id":
        current.epg_channel_id = stripQuotes(value) || null;
        break;
      case "epg_url":
        current.epg_url = stripQuotes(value) || null;
        break;
      case "epg_text":
      case "epg_alt_text":
        current.epg_alt_text = stripQuotes(value) || null;
        break;
      case "synopsis":
        current.epg_show_synopsis = isTrue(value);
        break;
      case "grab_logo":
        current.epg_grab_logo = isTrue(value);
        break;
      case "adult":
        current.is_adult = isTrue(value);
        break;
      case "proxy_token":
        current.use_proxy_token = isTrue(value);
        break;
      case "force_proxy":
        current.force_proxy_native = isTrue(value);
        break;
      case "sw_decoder":
        current.prefer_sw_decoder = isTrue(value);
        break;
      default:
        // ignora chaves desconhecidas (ex.: comentários do Flussonic)
        break;
    }

    if (flussonicSlug && !current.name && key === "input") {
      current.name = flussonicSlug.replace(/^live\//, "");
    }
  }
  finish();

  // números duplicados
  const seen = new Map<number, string>();
  for (const c of channels) {
    const prev = seen.get(c.channel_number);
    if (prev) errors.push(`Número ${c.channel_number} duplicado: "${prev}" e "${c.name}".`);
    else seen.set(c.channel_number, c.name);
  }

  return { channels, errors };
}
