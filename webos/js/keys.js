/* LN TV — LG webOS remote key codes (Magic Remote + controle comum) */
window.LNTV = window.LNTV || {};
LNTV.KEYS = {
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39,
  ENTER: 13, BACK: 461,
  N0: 48, N1: 49, N2: 50, N3: 51, N4: 52, N5: 53, N6: 54, N7: 55, N8: 56, N9: 57,
  RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
  CH_UP: 33, CH_DOWN: 34,
  PLAY: 415, PAUSE: 19, STOP: 413, REW: 412, FF: 417,
  INFO: 457, GUIDE: 458,
  // Teclado de PC (testes no navegador / simulador)
  ESC: 27, BACKSPACE: 8
};

/* Teclas que significam "voltar" (controle LG ou teclado do simulador). */
LNTV.isBackKey = function (code, target) {
  var K = LNTV.KEYS;
  if (code === K.BACK || code === K.ESC) return true;
  // Backspace só volta quando não está apagando texto num campo.
  if (code === K.BACKSPACE) return !(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA"));
  return false;
};

/* webOS entrega as teclas sem registro (diferente do Tizen). */
LNTV.registerKeys = function () {};
