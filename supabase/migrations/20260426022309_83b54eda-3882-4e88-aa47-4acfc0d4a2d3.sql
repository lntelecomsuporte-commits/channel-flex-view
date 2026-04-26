-- Consolida todos os tipos XMLTV (iptv_epg_org, open_epg, github_xml) e
-- também epg_pw num único valor "xmltv". Mantém "alt_text" e "none".
UPDATE public.channels
SET epg_type = 'xmltv'
WHERE epg_type IN ('iptv_epg_org', 'open_epg', 'github_xml', 'epg_pw');

UPDATE public.epg_url_presets
SET epg_type = 'xmltv'
WHERE epg_type IN ('iptv_epg_org', 'open_epg', 'github_xml', 'epg_pw');