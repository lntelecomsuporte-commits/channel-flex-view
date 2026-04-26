import { useState, useEffect, useRef, useCallback } from "react";
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
  const navigate = useNavigate();
  const pageRef = useRef<HTMLDivElement>(null);
  const activeInputRef = useRef<HTMLInputElement | null>(null);

  const scrollFocusedInputIntoView = useCallback(() => {
    window.setTimeout(() => {
      activeInputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }, 120);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handleViewportChange = () => scrollFocusedInputIntoView();
    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);

    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
    };
  }, [scrollFocusedInputIntoView]);

  useEffect(() => {
    let cleanupNative: (() => void) | undefined;

    (async () => {
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        const subscriptions = await Promise.all([
          Keyboard.addListener("keyboardWillShow", scrollFocusedInputIntoView),
          Keyboard.addListener("keyboardDidShow", scrollFocusedInputIntoView),
        ]);
        cleanupNative = () => {
          subscriptions.forEach((subscription) => void subscription.remove());
        };
      } catch {
        // Web/preview: visualViewport já cobre o comportamento.
      }
    })();

    return () => cleanupNative?.();
  }, [scrollFocusedInputIntoView]);

  const handleInputFocus = useCallback(
    (input: HTMLInputElement) => {
      activeInputRef.current = input;
      scrollFocusedInputIntoView();
    },
    [scrollFocusedInputIntoView]
  );

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

  return (
    <div
      ref={pageRef}
      className="min-h-[100dvh] overflow-y-auto bg-background p-4 flex items-center justify-center"
    >
      <div className="w-full max-w-sm py-8">
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
                  onFocus={(e) => handleInputFocus(e.currentTarget)}
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
                  onFocus={(e) => handleInputFocus(e.currentTarget)}
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
