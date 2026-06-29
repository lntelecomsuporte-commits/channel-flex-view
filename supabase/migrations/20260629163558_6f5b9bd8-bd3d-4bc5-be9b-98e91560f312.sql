
CREATE OR REPLACE FUNCTION public.short_link_hit(_slug text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.short_links
     SET hit_count = hit_count + 1,
         last_hit_at = now()
   WHERE slug = _slug;
$$;
REVOKE ALL ON FUNCTION public.short_link_hit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.short_link_hit(text) TO service_role;
