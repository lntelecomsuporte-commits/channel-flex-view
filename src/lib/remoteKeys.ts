export function isSelectKey(event: KeyboardEvent) {
  const key = event.key;
  const code = event.code;
  const keyCode = event.keyCode || (event as KeyboardEvent & { which?: number }).which || 0;

  return (
    key === "Enter" ||
    key === "NumpadEnter" ||
    key === "OK" ||
    key === "Select" ||
    key === "Center" ||
    code === "Enter" ||
    code === "NumpadEnter" ||
    code === "Select" ||
    keyCode === 13 ||
    keyCode === 23 ||
    keyCode === 66 ||
    keyCode === 160
  );
}

/**
 * Detecta o botão "Menu" / "Configuração" do controle (3 traços).
 * Em Fire TV / Android TV o KEYCODE_MENU é 82. Alguns controles mandam
 * "ContextMenu", "Settings" ou "AppSwitch".
 */
export function isMenuKey(event: KeyboardEvent) {
  const key = event.key;
  const keyCode = event.keyCode || 0;
  return (
    key === "ContextMenu" ||
    key === "Menu" ||
    key === "Settings" ||
    key === "AppSwitch" ||
    key === "Info" ||
    key === "MediaTopMenu" ||
    keyCode === 82 ||  // KEYCODE_MENU
    keyCode === 93 ||  // KEYCODE_GUIDE (alguns Smart TVs)
    keyCode === 18 ||  // KEYCODE_SETTINGS (raro)
    keyCode === 165 || // KEYCODE_INFO
    keyCode === 172    // KEYCODE_GUIDE (Android TV)
  );
}

/**
 * Detects fast-forward / channel-up keys across remotes
 * (FireTV, AndroidTV, generic media keys).
 */
export function isPageNextKey(event: KeyboardEvent) {
  const key = event.key;
  const keyCode = event.keyCode || 0;
  return (
    key === "MediaTrackNext" ||
    key === "MediaFastForward" ||
    key === "ChannelUp" ||
    key === "MediaNextTrack" ||
    key === "PageDown" ||
    keyCode === 166 || // CHANNEL_UP
    keyCode === 176 || // MEDIA_NEXT
    keyCode === 228 || // MEDIA_FAST_FORWARD
    keyCode === 425    // generic FF on some remotes
  );
}

export function isPagePrevKey(event: KeyboardEvent) {
  const key = event.key;
  const keyCode = event.keyCode || 0;
  return (
    key === "MediaTrackPrevious" ||
    key === "MediaRewind" ||
    key === "ChannelDown" ||
    key === "MediaPreviousTrack" ||
    key === "PageUp" ||
    keyCode === 167 || // CHANNEL_DOWN
    keyCode === 177 || // MEDIA_PREVIOUS
    keyCode === 227 || // MEDIA_REWIND
    keyCode === 424    // generic RW on some remotes
  );
}
