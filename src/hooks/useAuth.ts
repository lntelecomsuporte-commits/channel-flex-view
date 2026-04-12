import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkBlocked = useCallback(async (userId: string) => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_blocked, is_active")
      .eq("user_id", userId)
      .single();

    if (profile?.is_blocked || (profile && !profile.is_active)) {
      await supabase.auth.signOut();
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        supabase.rpc("has_role", {
          _user_id: currentUser.id,
          _role: "admin",
        }).then(({ data }) => {
          setIsAdmin(!!data);
          setLoading(false);
        });
      } else {
        setIsAdmin(false);
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          setTimeout(async () => {
            const { data } = await supabase.rpc("has_role", {
              _user_id: currentUser.id,
              _role: "admin",
            });
            setIsAdmin(!!data);
            setLoading(false);
          }, 0);
        } else {
          setIsAdmin(false);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Periodic check every 30s to detect if user was blocked
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      checkBlocked(user.id);
    }, 10000);

    return () => clearInterval(interval);
  }, [user, checkBlocked]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { user, isAdmin, loading, signIn, signOut };
}
