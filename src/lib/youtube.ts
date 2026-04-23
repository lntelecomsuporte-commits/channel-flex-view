/**
 * Detecta e extrai o videoId de uma URL do YouTube.
 * Suporta: watch?v=, youtu.be/, /live/, /embed/, /shorts/
 * Retorna null se não for URL do YouTube.
 */
export const extractYouTubeVideoId = (url: string): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      // /watch?v=ID
      const v = u.searchParams.get("v");
      if (v) return v;

      // /live/ID, /embed/ID, /shorts/ID
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && ["live", "embed", "shorts", "v"].includes(parts[0])) {
        return parts[1] || null;
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const isYouTubeUrl = (url: string): boolean => extractYouTubeVideoId(url) !== null;
