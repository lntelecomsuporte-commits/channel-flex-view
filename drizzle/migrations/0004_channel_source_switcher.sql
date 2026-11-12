CREATE OR REPLACE FUNCTION public.switch_channel_sources(
  _mode text,
  _source_origin text,
  _replacement_origin text DEFAULT NULL,
  _save_old_as_backup boolean DEFAULT true
)
RETURNS TABLE (
  matched_count integer,
  updated_count integer,
  skipped_without_backup integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source text := lower(rtrim(btrim(coalesce(_source_origin, '')), '/'));
  v_replacement text := lower(rtrim(btrim(coalesce(_replacement_origin, '')), '/'));
  v_port text;
BEGIN
  IF v_actor IS NULL OR NOT public.has_admin_permission(v_actor, 'channels.switch_source') THEN
    RAISE EXCEPTION 'Permissão channels.switch_source necessária' USING ERRCODE = '42501';
  END IF;

  IF _mode IS NULL OR _mode NOT IN ('invert', 'replace') THEN
    RAISE EXCEPTION 'Modo inválido: use invert ou replace';
  END IF;
  IF v_source !~* '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$' THEN
    RAISE EXCEPTION 'Endereço atual inválido: informe somente esquema, host e porta';
  END IF;

  v_port := (regexp_match(v_source, ':([0-9]+)$'))[1];
  IF v_port IS NOT NULL AND (v_port::integer < 1 OR v_port::integer > 65535) THEN
    RAISE EXCEPTION 'Porta de origem inválida';
  END IF;

  IF _mode = 'invert' THEN
    WITH matched AS MATERIALIZED (
      SELECT c.id, c.stream_url, c.backup_stream_urls
      FROM public.channels AS c
      WHERE substring(lower(c.stream_url) from '^(https?://[^/]+)') = v_source
      FOR UPDATE
    ), changed AS (
      UPDATE public.channels AS c
      SET
        stream_url = m.backup_stream_urls[1],
        backup_stream_urls = ARRAY[m.stream_url] || CASE
          WHEN cardinality(m.backup_stream_urls) > 1
            THEN m.backup_stream_urls[2:cardinality(m.backup_stream_urls)]
          ELSE ARRAY[]::text[]
        END
      FROM matched AS m
      WHERE c.id = m.id
        AND cardinality(m.backup_stream_urls) > 0
        AND btrim(m.backup_stream_urls[1]) <> ''
      RETURNING c.id
    )
    SELECT
      (SELECT count(*) FROM matched)::integer,
      (SELECT count(*) FROM changed)::integer,
      ((SELECT count(*) FROM matched) - (SELECT count(*) FROM changed))::integer
    INTO matched_count, updated_count, skipped_without_backup;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_replacement !~* '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$' THEN
    RAISE EXCEPTION 'Novo endereço inválido: informe somente esquema, host e porta';
  END IF;
  IF v_replacement = v_source THEN
    RAISE EXCEPTION 'O novo endereço precisa ser diferente do atual';
  END IF;
  v_port := (regexp_match(v_replacement, ':([0-9]+)$'))[1];
  IF v_port IS NOT NULL AND (v_port::integer < 1 OR v_port::integer > 65535) THEN
    RAISE EXCEPTION 'Porta de substituição inválida';
  END IF;

  WITH matched AS MATERIALIZED (
    SELECT c.id, c.stream_url, c.backup_stream_urls
    FROM public.channels AS c
    WHERE substring(lower(c.stream_url) from '^(https?://[^/]+)') = v_source
    FOR UPDATE
  ), changed AS (
    UPDATE public.channels AS c
    SET
      stream_url = regexp_replace(m.stream_url, '^(https?://[^/]+)', v_replacement, 'i'),
      backup_stream_urls = CASE
        WHEN coalesce(_save_old_as_backup, false)
          AND NOT (m.stream_url = ANY(coalesce(m.backup_stream_urls, ARRAY[]::text[])))
          THEN ARRAY[m.stream_url] || coalesce(m.backup_stream_urls, ARRAY[]::text[])
        ELSE coalesce(m.backup_stream_urls, ARRAY[]::text[])
      END
    FROM matched AS m
    WHERE c.id = m.id
    RETURNING c.id
  )
  SELECT
    (SELECT count(*) FROM matched)::integer,
    (SELECT count(*) FROM changed)::integer,
    0
  INTO matched_count, updated_count, skipped_without_backup;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.switch_channel_sources(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_channel_sources(text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.switch_channel_sources(text, text, text, boolean) TO service_role;