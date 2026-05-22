import { registerPlugin } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";

export interface DeviceInfoResult {
  deviceId: string;
  platform: "android" | "roku";
  model?: string;
  manufacturer?: string;
  osVersion?: string;
}

interface DeviceInfoPlugin {
  getDeviceId(): Promise<DeviceInfoResult>;
}

const NativeDeviceInfo = registerPlugin<DeviceInfoPlugin>("DeviceInfo");

/**
 * Retorna o ID estável do dispositivo (ANDROID_ID no APK).
 * Em PWA/web/iOS retorna null — esses contextos NÃO usam device binding.
 */
export async function getDeviceId(): Promise<DeviceInfoResult | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (Capacitor.getPlatform() !== "android") return null;
  try {
    const r = await NativeDeviceInfo.getDeviceId();
    if (!r.deviceId) return null;
    return r;
  } catch (e) {
    console.warn("[device-info] getDeviceId failed:", e);
    return null;
  }
}

/**
 * Formata o device id em blocos de 4 chars maiúsculos, separados por hífen,
 * para exibir na tela de login. Ex: "A1B2-C3D4-E5F6-G7H8"
 */
export function formatDeviceCode(deviceId: string, maxBlocks = 4): string {
  const clean = deviceId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const slice = clean.slice(0, maxBlocks * 4);
  const out: string[] = [];
  for (let i = 0; i < slice.length; i += 4) out.push(slice.slice(i, i + 4));
  return out.join("-");
}
