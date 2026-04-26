import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabaseLocal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Tv } from "lucide-react";
import { VirtualKeyboard } from "@/components/VirtualKeyboard";

const isNative = Capacitor.isNativePlatform();

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeField, setActiveField] = useState<"email" | "password">("email");
  const navigate = useNavigate();

  const handleKeyPress = (key: string) => {
    if (activeField === "email") setEmail((v) => v + key);
    else setPassword((v) => v + key);
  };

  const handleBackspace = () => {
    if (activeField === "email") setEmail((v) => v.slice(0, -1));
    else setPassword((v) => v.slice(0, -1));
  };

  const handleEnter = () => {
    if (activeField === "email") {
      setActiveField("password");
    } else {
      void doLogin();
    }
  };

  const doLogin = async () => {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void doLogin();
  };

  return (
    <div className="min-h-[100dvh] bg-background p-3 flex items-start justify-center overflow-y-auto">
      <div className="w-full max-w-sm py-4">
        <Card>
          <CardHeader className="text-center pb-3">
            <div className="flex justify-center mb-1">
              <Tv className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-xl">TV Login</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode={isNative ? "none" : "email"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setActiveField("email")}
                  readOnly={isNative}
                  required
                  placeholder="seu@email.com"
                  autoComplete="username"
                  className={activeField === "email" && isNative ? "ring-2 ring-primary" : ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  inputMode={isNative ? "none" : "text"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setActiveField("password")}
                  readOnly={isNative}
                  required
                  autoComplete="current-password"
                  className={activeField === "password" && isNative ? "ring-2 ring-primary" : ""}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Entrando..." : "Entrar"}
              </Button>
            </form>

            {isNative && (
              <VirtualKeyboard
                onKeyPress={handleKeyPress}
                onBackspace={handleBackspace}
                onEnter={handleEnter}
                mode={activeField === "email" ? "email" : "text"}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
