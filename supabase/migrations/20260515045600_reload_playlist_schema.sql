-- Garante que o PostgREST do self-hosted reconheça as colunas de playlist após aplicar a migration.
NOTIFY pgrst, 'reload schema';
