
CREATE TABLE public.category_includes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  included_category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_id, included_category_id),
  CHECK (category_id != included_category_id)
);

ALTER TABLE public.category_includes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage category includes"
ON public.category_includes
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view category includes"
ON public.category_includes
FOR SELECT
TO public
USING (true);
