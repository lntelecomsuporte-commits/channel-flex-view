ALTER TABLE public.channels ADD COLUMN epg_type text DEFAULT NULL;
ALTER TABLE public.channels ADD COLUMN epg_channel_id text DEFAULT NULL;
ALTER TABLE public.channels ADD COLUMN epg_grab_logo boolean NOT NULL DEFAULT false;
ALTER TABLE public.channels ADD COLUMN epg_show_synopsis boolean NOT NULL DEFAULT false;