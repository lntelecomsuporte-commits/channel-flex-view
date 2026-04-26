export const LOCAL_BACKEND_ORIGIN = "https://tv2.lntelecom.net";
export const LOCAL_AUTH_STORAGE_KEY = "lntv-local-auth-token";

const FORBIDDEN_CLOUD_MARKERS = [
  "supabase.co",
  "lovable.app",
  "lovableproject.com",
  "oxunkzltmlafatzfiikj",
];

const env = import.meta.env as Record<string, string | undefined>;

export const isForbiddenCloudValue = (value: string | null | undefined) => {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return FORBIDDEN_CLOUD_MARKERS.some((marker) => normalized.includes(marker));
};

export const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

export const isForbiddenCloudJwt = (token: string | null | undefined) => {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  return isForbiddenCloudValue(JSON.stringify(payload ?? {}));
};

const readLocalPublishableKey = () => {
  const key =
    env.VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    "";

  if (!key) {
    throw new Error("[LN TV] Chave pública local ausente. Configure a anon key local antes do build.");
  }

  if (isForbiddenCloudValue(key) || isForbiddenCloudJwt(key)) {
    throw new Error("[LN TV] Chave pública do Cloud bloqueada. Use somente a anon key local.");
  }

  return key;
};

export const LOCAL_SUPABASE_PUBLISHABLE_KEY = readLocalPublishableKey();

export const getLocalFunctionUrl = (functionName: string) =>
  `${LOCAL_BACKEND_ORIGIN}/functions/v1/${functionName}`;