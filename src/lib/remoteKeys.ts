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
