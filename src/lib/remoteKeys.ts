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
