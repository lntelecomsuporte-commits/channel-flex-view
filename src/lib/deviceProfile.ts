// Heurística de detecção de "device fraco" para ajustar buffer e cap de qualidade.
// Baseada em hardwareConcurrency, deviceMemory e UA. Resultado em cache (1ª chamada).

export interface DeviceProfile {
  weak: boolean;
  reason: string;
  cores: number;
  memoryGb: number;
  // Cap de altura vertical em pixels (ex: 720 para limitar a 720p). null = sem cap.
  maxHeight: number | null;
  // Buffer alvo em segundos.
  maxBufferLength: number;
}

let cached: DeviceProfile | null = null;

export function getDeviceProfile(): DeviceProfile {
  if (cached) return cached;

  const cores = navigator.hardwareConcurrency || 0;
  // @ts-ignore - deviceMemory não está em todos os tipos
  const memoryGb = (navigator as any).deviceMemory || 0;
  const ua = navigator.userAgent || "";

  // Sinais de TV box / Android antigo
  const isAndroidOld = /Android\s([1-7])\./.test(ua); // Android <= 7
  const isLowEndChromium = /Chrome\/(4[0-9]|5[0-9]|6[0-9])\./.test(ua); // Chromium <= 69
  const isAArch32 = /armv7|armeabi-v7a/i.test(ua);

  const reasons: string[] = [];
  if (cores > 0 && cores <= 4) reasons.push(`cores=${cores}`);
  if (memoryGb > 0 && memoryGb <= 2) reasons.push(`mem=${memoryGb}GB`);
  if (isAndroidOld) reasons.push("android<=7");
  if (isLowEndChromium) reasons.push("chromium-old");
  if (isAArch32) reasons.push("armv7");

  const weak = reasons.length > 0;

  cached = {
    weak,
    reason: weak ? reasons.join(", ") : "ok",
    cores,
    memoryGb,
    // Em devices fracos: cap em 720p e buffer maior pra absorver decoder lento.
    // Em devices fortes (Fire TV etc): sem cap, buffer pequeno pra zap rápido.
    maxHeight: weak ? 720 : null,
    maxBufferLength: weak ? 30 : 10,
  };

  // Log único
  console.log("[DeviceProfile]", cached);
  return cached;
}
