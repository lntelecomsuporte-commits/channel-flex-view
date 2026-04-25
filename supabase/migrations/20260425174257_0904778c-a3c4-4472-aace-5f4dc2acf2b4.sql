CREATE TABLE public.epg_url_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  epg_type TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.epg_url_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view epg presets"
ON public.epg_url_presets FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage epg presets"
ON public.epg_url_presets FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_epg_url_presets_updated_at
BEFORE UPDATE ON public.epg_url_presets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_epg_url_presets_type ON public.epg_url_presets(epg_type);

-- Sementes com as URLs padrão usadas no projeto
INSERT INTO public.epg_url_presets (epg_type, name, url) VALUES
  ('open_epg', 'Brasil 1', 'https://www.open-epg.com/files/brazil1.xml'),
  ('iptv_epg_org', 'Brasil (epg-br)', 'https://iptv-epg.org/files/epg-br.xml'),
  ('github_xml', 'BrazilTVEPG (Claro)', 'https://github.com/limaalef/BrazilTVEPG/raw/refs/heads/main/claro.xml');