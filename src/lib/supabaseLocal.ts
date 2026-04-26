import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  LOCAL_AUTH_STORAGE_KEY,
  LOCAL_BACKEND_ORIGIN,
  LOCAL_SUPABASE_PUBLISHABLE_KEY,
} from "@/lib/localBackend";

export const supabase = createClient<Database>(LOCAL_BACKEND_ORIGIN, LOCAL_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    storageKey: LOCAL_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
  },
});