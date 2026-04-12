
-- Add name column to hubsoft_config for identifying multiple integrations
ALTER TABLE public.hubsoft_config ADD COLUMN name text NOT NULL DEFAULT 'Integração Principal';

-- Junction table: which categories each integration manages
CREATE TABLE public.hubsoft_config_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hubsoft_config_id uuid NOT NULL REFERENCES public.hubsoft_config(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hubsoft_config_id, category_id)
);

ALTER TABLE public.hubsoft_config_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage hubsoft config categories"
ON public.hubsoft_config_categories
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Track which categories each user has access to
CREATE TABLE public.user_category_access (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  hubsoft_config_id uuid REFERENCES public.hubsoft_config(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, category_id)
);

ALTER TABLE public.user_category_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage user category access"
ON public.user_category_access
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own category access"
ON public.user_category_access
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
