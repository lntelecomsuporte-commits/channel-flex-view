/**
 * Rastreia se o usuário já fez QUALQUER gesto na página.
 * WebViews/navegadores liberam autoplay com áudio depois do primeiro gesto,
 * e esse "crédito" vale para a sessão inteira da aba.
 *
 * Usamos isso para abrir canais do YouTube já com som, sem precisar
 * tocar na tela a cada troca de canal.
 */
let hasInteracted = false;
const listeners = new Set<() => void>();

const markInteracted = () => {
  if (hasInteracted) return;
  hasInteracted = true;
  listeners.forEach((cb) => {
    try { cb(); } catch {}
  });
};

if (typeof window !== "undefined") {
  const opts = { capture: true, passive: true } as AddEventListenerOptions;
  window.addEventListener("pointerdown", markInteracted, opts);
  window.addEventListener("touchstart", markInteracted, opts);
  window.addEventListener("click", markInteracted, opts);
  window.addEventListener("keydown", markInteracted, opts);
}

export const hasUserInteracted = () => hasInteracted;

export const onFirstInteraction = (cb: () => void): (() => void) => {
  if (hasInteracted) {
    cb();
    return () => {};
  }
  listeners.add(cb);
  return () => listeners.delete(cb);
};
