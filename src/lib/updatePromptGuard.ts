import { isSelectKey } from "@/lib/remoteKeys";

type UpdatePromptController = {
  isOpen: boolean;
  isBusy: boolean;
  moveFocus: () => void;
  activateFocused: () => void;
  dismiss: () => void;
};

let controller: UpdatePromptController | null = null;
let installed = false;

const getKeyCode = (event: KeyboardEvent) =>
  event.keyCode || (event as KeyboardEvent & { which?: number }).which || 0;

const isBackKey = (event: KeyboardEvent) => {
  const code = getKeyCode(event);
  return event.key === "Escape" || event.key === "GoBack" || event.key === "Backspace" || code === 4 || code === 27;
};

const isNavigationKey = (event: KeyboardEvent) => {
  const code = getKeyCode(event);
  return (
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight" ||
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    code === 19 ||
    code === 20 ||
    code === 21 ||
    code === 22
  );
};

const block = (event: KeyboardEvent) => {
  event.preventDefault();
  event.stopPropagation();
  (event as KeyboardEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
};

const handleUpdatePromptKey = (event: KeyboardEvent) => {
  const active = controller?.isOpen || document.body.dataset.updatePromptOpen === "true";
  if (!active) return;

  block(event);
  if (event.type !== "keydown" || !controller || controller.isBusy) return;

  if (isBackKey(event)) {
    controller.dismiss();
    return;
  }

  if (isNavigationKey(event)) {
    controller.moveFocus();
    return;
  }

  if (isSelectKey(event)) {
    controller.activateFocused();
  }
};

export function installGlobalUpdatePromptGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const options: AddEventListenerOptions = { capture: true, passive: false };
  window.addEventListener("keydown", handleUpdatePromptKey, options);
  window.addEventListener("keyup", handleUpdatePromptKey, options);
  window.addEventListener("keypress", handleUpdatePromptKey, options);
  document.addEventListener("keydown", handleUpdatePromptKey, options);
  document.addEventListener("keyup", handleUpdatePromptKey, options);
  document.addEventListener("keypress", handleUpdatePromptKey, options);
}

export function setUpdatePromptController(next: UpdatePromptController | null) {
  controller = next;
}