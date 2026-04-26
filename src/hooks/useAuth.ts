import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseLocal";
import type { User } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkBlocked = useCallback(async (userId: string) => {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("is_blocked, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    // Network/transient errors: do NOT sign out (FireTV suspend, offline, etc.)
    if (error) {
      console.warn("[useAuth] checkBlocked error (ignored):", error.message);
      return false;
    }

    // Only sign out on EXPLICIT block/inactive — never on missing profile
    if (profile && (profile.is_blocked || !profile.is_active)) {
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
          // IMPORTANT: NEVER set loading=true here. Doing so would unmount
          // <PlayerPage/> via <ProtectedRoute> on every TOKEN_REFRESHED event
          // (~every 50min) and reset currentIndex back to channel 0.
          setTimeout(async () => {
            const { data, error } = await supabase.rpc("has_role", {
              _user_id: currentUser.id,
              _role: "admin",
            });
            if (error) console.warn("[useAuth] has_role error:", error.message);
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
