import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabaseLocal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Tv, Eye, EyeOff, ArrowLeft, ArrowRight } from "lucide-react";
import { VirtualKeyboard } from "@/components/VirtualKeyboard";

const isNative = Capacitor.isNativePlatform();

// Detecta PWA instalado (standalone) — iOS e Android
function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as any).standalone === true;
  return !!(mq || iosStandalone);
}

// Detecta TV / tela grande landscape — usa layout wizard (1 campo por vez)
function detectTvLayout(): boolean {
  if (typeof window === "undefined") return false;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const landscape = w >= h;
  // TV: tela grande E landscape
  return landscape && w >= 900;
}

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activeField, setActiveField] = useState<"email" | "password">("email");
  const [isStandalone, setIsStandalone] = useState(false);
  const [isTvLayout, setIsTvLayout] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setIsStandalone(detectStandalone());
    const update = () => setIsTvLayout(detectTvLayout());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Mostra teclado virtual no APK nativo OU no PWA instalado (standalone)
  const useVirtualKeyboard = isNative || isStandalone;
  // Layout wizard (1 campo por vez ao lado do teclado) só em TV com teclado virtual
  const useWizardLayout = useVirtualKeyboard && isTvLayout;

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

  // ============= LAYOUT WIZARD (TV) =============
  if (useWizardLayout) {
    const isEmailStep = activeField === "email";
    const currentValue = isEmailStep ? email : password;
    const fieldLabel = isEmailStep ? "Email" : "Senha";
    const displayValue = isEmailStep
      ? (email || "seu@email.com")
      : (showPassword ? password : "•".repeat(password.length));
    const isPlaceholder = isEmailStep && !email;

    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-6xl grid grid-cols-[1fr_1.3fr] gap-8 items-center">
          {/* Lado esquerdo: branding + campo atual */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Tv className="h-12 w-12 text-primary" />
              <h1 className="text-3xl font-bold">TV Login</h1>
            </div>

            <div className="space-y-2">
              <Label className="text-lg text-muted-foreground">{fieldLabel}</Label>
              <div
                className={`min-h-[60px] rounded-md border-2 px-4 py-3 text-2xl break-all ${
                  isPlaceholder ? "text-muted-foreground" : "text-foreground"
                } border-primary bg-card`}
              >
                {displayValue || "\u00A0"}
              </div>
              {!isEmailStep && (
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showPassword ? "Ocultar" : "Mostrar"} senha
                </button>
              )}
            </div>

            {/* Indicador de etapa */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={isEmailStep ? "text-primary font-medium" : ""}>1. Email</span>
              <span>→</span>
              <span className={!isEmailStep ? "text-primary font-medium" : ""}>2. Senha</span>
            </div>

            {/* Botões Voltar / Avançar / Entrar */}
            <div className="flex gap-3">
              {!isEmailStep && (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-14 text-lg flex-1"
                  onClick={() => setActiveField("email")}
                >
                  <ArrowLeft className="h-5 w-5 mr-2" /> Voltar
                </Button>
              )}
              {isEmailStep ? (
                <Button
                  type="button"
                  className="h-14 text-lg flex-1"
                  onClick={() => setActiveField("password")}
                  disabled={!email}
                >
                  Avançar <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-14 text-lg flex-1"
                  onClick={() => void doLogin()}
                  disabled={loading || !password}
                >
                  {loading ? "Entrando..." : "Entrar"}
                </Button>
              )}
            </div>
          </div>

          {/* Lado direito: teclado */}
          <div>
            <VirtualKeyboard
              key={activeField}
              onKeyPress={handleKeyPress}
              onBackspace={handleBackspace}
              onEnter={handleEnter}
              mode={isEmailStep ? "email" : "text"}
              autoFocus
            />
          </div>
        </div>
      </div>
    );
  }

  // ============= LAYOUT MOBILE / DEFAULT =============
  return (
    <div className="min-h-[100dvh] bg-background p-3 sm:p-6 flex items-start sm:items-center justify-center overflow-y-auto">
      <div className="w-full max-w-sm sm:max-w-md lg:max-w-lg xl:max-w-xl py-4">
        <Card>
          <CardHeader className="text-center pb-3 sm:pb-4">
            <div className="flex justify-center mb-1 sm:mb-2">
              <Tv className="h-8 w-8 sm:h-12 sm:w-12 lg:h-14 lg:w-14 text-primary" />
            </div>
            <CardTitle className="text-xl sm:text-2xl lg:text-3xl">TV Login</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4">
            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="sm:text-base">Email</Label>
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
                  className={`sm:h-12 sm:text-base ${activeField === "email" && useVirtualKeyboard ? "ring-2 ring-primary" : ""}`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="sm:text-base">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    inputMode={isNative ? "none" : "text"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setActiveField("password")}
                    readOnly={isNative}
                    required
                    autoComplete="current-password"
                    className={`pr-11 sm:h-12 sm:text-base ${activeField === "password" && useVirtualKeyboard ? "ring-2 ring-primary" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex items-center justify-center w-10 sm:w-12 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" /> : <Eye className="h-4 w-4 sm:h-5 sm:w-5" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full sm:h-12 sm:text-base" disabled={loading}>
                {loading ? "Entrando..." : "Entrar"}
              </Button>
            </form>

            {useVirtualKeyboard && (
              <VirtualKeyboard
                onKeyPress={handleKeyPress}
                onBackspace={handleBackspace}
                onEnter={handleEnter}
                onFieldUp={() => setActiveField("email")}
                onFieldDown={() => setActiveField("password")}
                mode={activeField === "email" ? "email" : "text"}
                autoFocus
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
