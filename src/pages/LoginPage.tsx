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
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const activeInputRef = useRef<HTMLInputElement | null>(null);

  const keepFocusedInputAboveKeyboard = useCallback(() => {
    if (keyboardHeight <= 0 || !activeInputRef.current) {
      setKeyboardOffset(0);
      return;
    }

    requestAnimationFrame(() => {
      const inputRect = activeInputRef.current?.getBoundingClientRect();
      const cardRect = cardRef.current?.getBoundingClientRect();
      if (!inputRect || !cardRect) return;

      const safeBottom = window.innerHeight - keyboardHeight - 24;
      const overlap = inputRect.bottom - safeBottom;

      if (overlap <= 0) return;

      setKeyboardOffset((current) => {
        const originalCardTop = cardRect.top + current;
        const maxOffset = Math.max(0, originalCardTop + 96);
        return Math.min(current + overlap, maxOffset);
      });
    });
  }, [keyboardHeight]);

  // Detect keyboard via Capacitor (native) and visualViewport (web fallback)
  useEffect(() => {
    let cleanupNative: (() => void) | undefined;
    let cleanupViewport: (() => void) | undefined;

    const vv = window.visualViewport;
    if (vv) {
      const onResize = () => {
        const diff = window.innerHeight - vv.height;
        setKeyboardHeight(diff > 100 ? diff : 0);
      };
      vv.addEventListener("resize", onResize);
      vv.addEventListener("scroll", onResize);
      cleanupViewport = () => {
        vv.removeEventListener("resize", onResize);
        vv.removeEventListener("scroll", onResize);
      };
    }

    // Capacitor native keyboard events
    (async () => {
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        const show = (info: { keyboardHeight: number }) => {
          setKeyboardHeight(info.keyboardHeight);
        };
        const hide = () => {
          setKeyboardHeight(0);
          setKeyboardOffset(0);
        };
        const subscriptions = await Promise.all([
          Keyboard.addListener("keyboardWillShow", show),
          Keyboard.addListener("keyboardDidShow", show),
          Keyboard.addListener("keyboardWillHide", hide),
          Keyboard.addListener("keyboardDidHide", hide),
        ]);
        cleanupNative = () => {
          subscriptions.forEach((subscription) => void subscription.remove());
        };
      } catch {
        // not running in Capacitor — visualViewport fallback remains active
      }
    })();

    return () => {
      cleanupNative?.();
      cleanupViewport?.();
    };
  }, []);

  useEffect(() => {
    keepFocusedInputAboveKeyboard();
  }, [keyboardHeight, keepFocusedInputAboveKeyboard]);

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
    <div className="fixed inset-0 flex items-center justify-center bg-background p-4 overflow-hidden">
      <div
        ref={cardRef}
        className="w-full max-w-sm transition-transform duration-200"
        style={{ transform: `translateY(-${keyboardOffset}px)` }}
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
                  onFocus={(e) => {
                    activeInputRef.current = e.currentTarget;
                    keepFocusedInputAboveKeyboard();
                  }}
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
                  onFocus={(e) => {
                    activeInputRef.current = e.currentTarget;
                    keepFocusedInputAboveKeyboard();
                  }}
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
