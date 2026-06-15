/**
 * Detecção de teclas pra troca de Legenda (CC / azul) e Áudio (SAP / amarelo).
 * Compartilhado entre VideoPlayer (web/HLS.js) e NativeAndroidPlayer.
 *
 * Persistência: apenas memória da sessão. Ao fechar o app, volta ao padrão.
 */

export function isSubtitleKey(event: KeyboardEvent): boolean {
  const key = event.key;
  const keyCode = event.keyCode || 0;
  return (
    key === "Subtitle" ||
    key === "ClosedCaptionToggle" ||
    key === "CC" ||
    key === "ColorF3Blue" ||
    key === "F3" || // alguns controles smart TV
    keyCode === 175 || // KEYCODE_CAPTIONS
    keyCode === 186 || // KEYCODE_PROG_BLUE
    keyCode === 406    // generic remote "blue"
  );
}

export function isAudioTrackKey(event: KeyboardEvent): boolean {
  const key = event.key;
  const keyCode = event.keyCode || 0;
  return (
    key === "AudioTrack" ||
    key === "MediaAudioTrack" ||
    key === "Audio" ||
    key === "SAP" ||
    key === "ColorF2Yellow" ||
    key === "F2" ||
    keyCode === 222 || // KEYCODE_MEDIA_AUDIO_TRACK
    keyCode === 252 || // KEYCODE_TV_AUDIO_DESCRIPTION
    keyCode === 185 || // KEYCODE_PROG_YELLOW
    keyCode === 405    // generic remote "yellow"
  );
}

/** Rótulo amigável de uma faixa (label > name > lang > "Faixa N"). */
export function trackLabel(
  t: { name?: string; label?: string; lang?: string; language?: string } | null | undefined,
  index: number,
): string {
  if (!t) return "Desligado";
  const l = t.label || t.name || t.lang || t.language;
  if (l && l.trim()) return l;
  return `Faixa ${index + 1}`;
}
