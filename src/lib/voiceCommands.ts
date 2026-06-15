/**
 * Parser e dispatcher de comandos de voz pro player.
 * Reconhece em pt-BR:
 *   "canal 23" / "23"              → sintoniza canal pelo número
 *   "globo" / "espn" / "band"      → fuzzy match pelo nome
 *   "áudio" / "som" / "sap"        → cicla trilha de áudio
 *   "legenda" / "caption" / "cc"   → cicla legenda
 *   "desligar" / "sair" / "fechar" → fecha o app (tenta standby HW)
 *
 * O parser apenas dispara o CustomEvent `lntv:voice-action`. Quem age é o
 * PlayerPage, que tem acesso aos hooks de canal/player.
 */

import type { Channel } from "@/hooks/useChannels";

export type VoiceActionType =
  | { type: "tuneNumber"; number: number }
  | { type: "tuneChannelId"; id: string; name: string }
  | { type: "audio" }
  | { type: "subtitle" }
  | { type: "shutdown" }
  | { type: "unknown"; raw: string };

const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const normalize = (s: string) => stripAccents(s).toLowerCase().trim();

const NUM_WORDS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
  quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};

function wordsToNumber(text: string): number | null {
  // "vinte e tres" → 23. Aceita também dígitos crus.
  const cleaned = text.replace(/\s+e\s+/g, " ").trim();
  if (/^\d{1,4}$/.test(cleaned)) return parseInt(cleaned, 10);
  const parts = cleaned.split(/\s+/);
  let sum = 0;
  let any = false;
  for (const p of parts) {
    if (NUM_WORDS[p] != null) { sum += NUM_WORDS[p]; any = true; }
    else return null;
  }
  return any ? sum : null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const v: number[] = Array(bl + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= al; i++) {
    let prev = v[0]; v[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = v[j];
      v[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, v[j], v[j - 1]) + 1;
      prev = tmp;
    }
  }
  return v[bl];
}

function fuzzyChannelMatch(query: string, channels: Channel[]): Channel | null {
  const q = normalize(query);
  if (!q) return null;
  let best: { ch: Channel; score: number } | null = null;
  for (const ch of channels) {
    const name = normalize(ch.name);
    let score = 0;
    if (name === q) score = 1000;
    else if (name.startsWith(q) || q.startsWith(name)) score = 500 - Math.abs(name.length - q.length);
    else if (name.includes(q) || q.includes(name)) score = 300 - Math.abs(name.length - q.length);
    else {
      const dist = levenshtein(name, q);
      const maxLen = Math.max(name.length, q.length);
      if (dist <= 2 || dist / maxLen < 0.34) score = 200 - dist * 10;
    }
    if (score > 0 && (!best || score > best.score)) best = { ch, score };
  }
  return best?.ch ?? null;
}

export function parseVoiceCommand(raw: string, channels: Channel[] | undefined): VoiceActionType {
  const t = normalize(raw || "");
  if (!t) return { type: "unknown", raw };

  // áudio/SAP
  if (/^(audio|som|sap|mts|trilha( de audio)?)$/.test(t) ||
      /\b(trocar|mudar|alternar|proximo|outro)\s+(audio|som|trilha|idioma)\b/.test(t)) {
    return { type: "audio" };
  }
  // legenda/CC
  if (/^(legenda|legendas|caption|closed caption|cc|subtitulo|subtitulos)$/.test(t) ||
      /\b(trocar|mudar|alternar|ativar|desativar|tirar|por|botar)\s+(legenda|caption|cc|subtitulo)/.test(t) ||
      /\b(legenda|caption|cc|subtitulo)\b/.test(t)) {
    return { type: "subtitle" };
  }
  // desligar
  if (/^(desligar|desliga|sair|fechar|fecha|tchau|encerrar|finalizar)$/.test(t) ||
      /\b(desligar|desliga)\s+(tv|aparelho|receptor|tudo)\b/.test(t)) {
    return { type: "shutdown" };
  }

  // canal por número: "canal 23", "canal vinte e tres", "23"
  const numMatch = t.match(/^(?:canal\s+|numero\s+|n[uo]\s+)?(.+)$/);
  if (numMatch) {
    const candidate = numMatch[1];
    const n = wordsToNumber(candidate);
    if (n != null && n >= 0 && n < 10000) {
      return { type: "tuneNumber", number: n };
    }
  }

  // fallback: nome do canal (remove prefixo "canal" se houver)
  const nameQuery = t.replace(/^(canal|coloca|colocar|poe|por|abre|abrir|sintoniza|sintonizar|ver|assistir|quero ver|quero assistir|botar)\s+/, "");
  if (channels?.length) {
    const found = fuzzyChannelMatch(nameQuery, channels);
    if (found) return { type: "tuneChannelId", id: found.id, name: found.name };
  }

  return { type: "unknown", raw };
}

export function dispatchVoiceAction(action: VoiceActionType) {
  window.dispatchEvent(new CustomEvent("lntv:voice-action", { detail: action }));
}

// ====== UI events ======
export type VoiceUiState =
  | { kind: "listening"; partial?: string }
  | { kind: "result"; text: string }
  | { kind: "error"; message: string }
  | { kind: "idle" };

export function emitVoiceUi(state: VoiceUiState) {
  window.dispatchEvent(new CustomEvent("lntv:voice-ui", { detail: state }));
}

// ====== Trigger (compartilhado por plugin nativo e Web Speech API) ======
export async function startVoiceCapture(): Promise<void> {
  // 1) Plugin Capacitor (APK release + nativo via WebView bridge)
  try {
    const { Voice } = await import("@/plugins/voice");
    if (await Voice.isAvailable()) {
      await Voice.start();
      return;
    }
  } catch { /* ignore — cai pro Web Speech */ }

  // 2) Web Speech API (PWA / Chrome / Edge)
  const W = window as any;
  const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!SR) {
    emitVoiceUi({ kind: "error", message: "Voz não disponível neste dispositivo" });
    setTimeout(() => emitVoiceUi({ kind: "idle" }), 2200);
    return;
  }
  const rec = new SR();
  rec.lang = "pt-BR";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = "";
  emitVoiceUi({ kind: "listening" });
  rec.onresult = (ev: any) => {
    let partial = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else partial += r[0].transcript;
    }
    emitVoiceUi({ kind: "listening", partial: (finalText + " " + partial).trim() });
  };
  rec.onerror = (e: any) => {
    emitVoiceUi({ kind: "error", message: e?.error === "no-speech" ? "Não entendi" : "Erro de voz" });
    setTimeout(() => emitVoiceUi({ kind: "idle" }), 2000);
  };
  rec.onend = () => {
    if (finalText.trim()) {
      window.dispatchEvent(new CustomEvent("lntv:voice-transcript", { detail: { text: finalText.trim() } }));
    } else {
      emitVoiceUi({ kind: "error", message: "Não entendi" });
      setTimeout(() => emitVoiceUi({ kind: "idle" }), 2000);
    }
  };
  try { rec.start(); } catch { /* já está rodando */ }
}

// ====== Key detection ======
export function isVoiceKey(event: KeyboardEvent): boolean {
  const key = event.key;
  const keyCode = event.keyCode || 0;
  return (
    key === "VoiceAssist" ||
    key === "Assist" ||
    key === "MicrophoneToggle" ||
    keyCode === 231 || // KEYCODE_VOICE_ASSIST
    keyCode === 219 || // KEYCODE_ASSIST
    keyCode === 449    // generic mic on some remotes
  );
}
