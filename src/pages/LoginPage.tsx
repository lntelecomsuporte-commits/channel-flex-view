import { useState } from "react";
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      toast.error("Credenciais inválidas");
      setLoading(false);
      return;
    }

    // Check if user is blocked
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

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Garante que o campo focado fique visível acima do teclado virtual (Android/iOS)
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  };

  return (
    <div className="flex min-h-screen items-start justify-center overflow-y-auto bg-background p-4 pt-8 pb-[50vh]">
      <Card className="w-full max-w-sm">
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
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onFocus={handleFocus} required placeholder="seu@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onFocus={handleFocus} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;
