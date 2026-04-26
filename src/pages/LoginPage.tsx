import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseLocal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Tv } from "lucide-react";

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);

  // Detect keyboard via Capacitor (native) and visualViewport (web fallback)
  useEffect(() => {
    let cleanupNative: (() => void) | undefined;

    // Capacitor native keyboard events
    (async () => {
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        const showSub = await Keyboard.addListener("keyboardWillShow", (info) => {
          setKeyboardHeight(info.keyboardHeight);
        });
        const hideSub = await Keyboard.addListener("keyboardWillHide", () => {
          setKeyboardHeight(0);
        });
        cleanupNative = () => {
          showSub.remove();
          hideSub.remove();
        };
      } catch {
        // not running in Capacitor — use visualViewport fallback
        const vv = window.visualViewport;
        if (!vv) return;
        const onResize = () => {
          const diff = window.innerHeight - vv.height;
          setKeyboardHeight(diff > 100 ? diff : 0);
        };
        vv.addEventListener("resize", onResize);
        cleanupNative = () => vv.removeEventListener("resize", onResize);
      }
    })();

    return () => {
      cleanupNative?.();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error("Credenciais inválidas");
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_blocked, is_active")
      .eq("user_id", data.user.id)
      .single();

    if (profile?.is_blocked) {
      await supabase.auth.signOut();
      toast.error("Seu acesso está bloqueado. Contate o suporte.");
      setLoading(false);
      return;
    }

    if (profile && !profile.is_active) {
      await supabase.auth.signOut();
      toast.error("Sua conta está inativa.");
      setLoading(false);
      return;
    }

    setLoading(false);
    navigate("/");
  };

  // Translate the card up so it sits above the keyboard with a small gap.
  const offset = keyboardHeight > 0 ? Math.max(0, keyboardHeight / 2 - 20) : 0;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-4 overflow-hidden">
      <div
        ref={cardRef}
        className="w-full max-w-sm transition-transform duration-200"
        style={{ transform: `translateY(-${offset}px)` }}
      >
        <Card>
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <Tv className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="text-2xl">TV Login</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="seu@email.com"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Entrando..." : "Entrar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
