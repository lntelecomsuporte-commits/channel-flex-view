/* LN TV — Samsung Tizen VK_* key map */
window.LNTV = window.LNTV || {};
LNTV.KEYS = {
  // Arrows / OK / Back
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39,
  ENTER: 13, BACK: 10009,

  // Numeric 0..9
  N0: 48, N1: 49, N2: 50, N3: 51, N4: 52, N5: 53, N6: 54, N7: 55, N8: 56, N9: 57,

  // Color keys
  RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,

  // Media
  CH_UP: 427, CH_DOWN: 428,
  PLAY: 415, PAUSE: 19, STOP: 413, PLAY_PAUSE: 10252,
  REW: 412, FF: 417, NEXT: 10233, PREV: 10232,

  // Menu / info / tools / exit
  MENU: 18,            // VK_MENU
  TOOLS: 10135,
  INFO: 457,
  EXIT: 10182,
  GUIDE: 458,

  // Subtitles / audio
  CC: 10225,
  AUDIO: 10190,
  MUTE: 449,

  // Voice (Samsung Smart remote mic — varia, registramos quando possível)
  VOICE: 10221
};

LNTV.registerKeys = function () {
  if (typeof tizen === "undefined" || !tizen.tvinputdevice) return;
  var names = [
    "MediaPlay","MediaPause","MediaStop","MediaPlayPause",
    "MediaRewind","MediaFastForward","MediaTrackNext","MediaTrackPrevious",
    "0","1","2","3","4","5","6","7","8","9",
    "ColorF0Red","ColorF1Green","ColorF2Yellow","ColorF3Blue",
    "ChannelUp","ChannelDown",
    "Menu","Tools","Info","Exit","Guide",
    "Caption","Subtitle","MTS","Source"
  ];
  names.forEach(function (k) {
    try { tizen.tvinputdevice.registerKey(k); }
    catch (e) { /* ignore unsupported */ }
  });
};
