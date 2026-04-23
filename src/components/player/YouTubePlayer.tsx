interface YouTubePlayerProps {
  videoId: string;
  autoPlay?: boolean;
}

const YouTubePlayer = ({ videoId, autoPlay = true }: YouTubePlayerProps) => {
  // Player oficial via iframe. Parâmetros:
  // - autoplay: começa tocando
  // - playsinline: evita fullscreen forçado em iOS
  // - rel=0: não mostra vídeos relacionados de outros canais
  // - modestbranding=1: minimiza marca do YouTube
  // - mute=1 inicial necessário para autoplay funcionar em mobile/WebView
  const params = new URLSearchParams({
    autoplay: autoPlay ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    mute: "1",
  });
  const src = `https://www.youtube.com/embed/${videoId}?${params.toString()}`;

  return (
    <iframe
      key={videoId}
      src={src}
      className="absolute inset-0 w-full h-full"
      title="YouTube player"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      frameBorder={0}
    />
  );
};

export default YouTubePlayer;
