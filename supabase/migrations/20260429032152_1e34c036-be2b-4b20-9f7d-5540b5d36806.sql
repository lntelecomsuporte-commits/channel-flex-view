ALTER TABLE public.channels
ADD COLUMN IF NOT EXISTS stream_format text NOT NULL DEFAULT 'auto';

ALTER TABLE public.channels
DROP CONSTRAINT IF EXISTS channels_stream_format_check;

ALTER TABLE public.channels
ADD CONSTRAINT channels_stream_format_check
CHECK (stream_format IN ('auto','hls','ts','mp4'));

COMMENT ON COLUMN public.channels.stream_format IS 'Formato do stream: auto (detecta pela extensão), hls (.m3u8), ts (MPEG-TS via mpegts.js) ou mp4 (progressivo).';

NOTIFY pgrst, 'reload schema';