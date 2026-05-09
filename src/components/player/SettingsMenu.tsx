import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseLocal";
import { toast } from "sonner";
import { isSelectKey } from "@/lib/remoteKeys";
import PinPrompt from "./PinPrompt";

interface SettingsMenuProps {
  onClose: () => void;
  onLogout: () => void;
  userId: string;
  userEmail?: string | null;
}

type View = "menu" | "change-password" | "change-pin-current" | "change-pin-new" | "about";

const ITEMS = [
  { id: "change-password", label: "🔑 Trocar senha de login" },
  { id: "change-pin", label: "🔞 Trocar PIN dos canais adultos" },
  { id: "about", label: "ℹ️ Sobre o aplicativo" },
  { id: "logout", label: "🚪 Sair da conta" },
] as const;

export default function SettingsMenu({ onClose, onLogout, userId, userEmail }: SettingsMenuProps) {
  const [view, setView] = useState<View>("menu");
  const [focused, setFocused] = useState(0);
  const [currentPin, setCurrentPin] = useState<string>("1234");
  const [appInfo, setAppInfo] = useState<{ version: string; build: string } | null>(null);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const pwdInputRef = useRef<HTMLInputElement>(null);

  // Carrega PIN atual e versão do app
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("adult_pin")
        .eq("user_id", userId)
        .maybeSingle();
      if (data?.adult_pin) setCurrentPin(data.adult_pin);
    })();
    import("@capacitor/app")
      .then(({ App }) => App.getInfo())
      .then((info) => setAppInfo({ version: info.version, build: info.build }))
      .catch(() => setAppInfo({ version: "web", build: "-" }));
  }, [userId]);

  // Captura teclas do menu (não na sub-view de PIN — PinPrompt cuida)
  useEffect(() => {
    if (view === "change-pin-current" || view === "change-pin-new") return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();

      if (e.key === "Escape" || e.key === "Backspace") {
        if (view === "menu") onClose();
        else setView("menu");
        return;
      }

      if (view !== "menu") {
        // Sub-views (about, change-password) usam OK pra fechar
        if (isSelectKey(e) && view === "about") setView("menu");
        return;
      }

      if (e.key === "ArrowDown") {
        setFocused((i) => (i + 1) % ITEMS.length);
        return;
      }
      if (e.key === "ArrowUp") {
        setFocused((i) => (i - 1 + ITEMS.length) % ITEMS.length);
        return;
      }
      if (isSelectKey(e)) {
        const id = ITEMS[focused].id;
        if (id === "logout") {
          onLogout();
          onClose();
        } else if (id === "change-password") {
          setView("change-password");
          setTimeout(() => pwdInputRef.current?.focus(), 50);
        } else if (id === "change-pin") {
          setView("change-pin-current");
        } else if (id === "about") {
          setView("about");
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [view, focused, onClose, onLogout]);

  const handleSavePassword = async () => {
    if (pwd.length < 6) {
      toast.error("Senha precisa ter no mínimo 6 caracteres");
      return;
    }
    if (pwd !== pwd2) {
      toast.error("As senhas não coincidem");
      return;
    }
    setSavingPwd(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setSavingPwd(false);
    if (error) {
      toast.error("Erro: " + error.message);
    } else {
      toast.success("Senha atualizada!");
      setPwd("");
      setPwd2("");
      setView("menu");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-background/95 animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-6 w-[min(92vw,560px)] max-h-[90vh] overflow-y-auto bg-card border border-border rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-foreground">⚙️ Configurações</h2>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Fechar ✕
          </button>
        </div>

        {view === "menu" && (
          <>
            {userEmail && (
              <p className="text-xs text-muted-foreground mb-3">
                Conectado como <strong>{userEmail}</strong>
              </p>
            )}
            <div className="space-y-2">
              {ITEMS.map((item, i) => (
                <div
                  key={item.id}
                  className={`px-4 py-3 rounded-lg cursor-pointer transition-colors ${
                    i === focused
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary hover:bg-secondary/70 text-foreground"
                  }`}
                  onClick={() => {
                    setFocused(i);
                    // dispara o mesmo handler de OK
                    if (item.id === "logout") { onLogout(); onClose(); }
                    else if (item.id === "change-password") { setView("change-password"); setTimeout(() => pwdInputRef.current?.focus(), 50); }
                    else if (item.id === "change-pin") setView("change-pin-current");
                    else if (item.id === "about") setView("about");
                  }}
                >
                  {item.label}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              ↑↓ navegar • OK selecionar • Voltar fechar
            </p>
          </>
        )}

        {view === "change-password" && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Trocar senha de login</h3>
            <div>
              <label className="text-xs text-muted-foreground">Nova senha</label>
              <input
                ref={pwdInputRef}
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-md bg-input text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Confirmar nova senha</label>
              <input
                type="password"
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-md bg-input text-foreground border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => { setPwd(""); setPwd2(""); setView("menu"); }}
                className="px-4 py-2 rounded-md bg-secondary text-foreground"
              >
                Cancelar
              </button>
              <button
                disabled={savingPwd}
                onClick={handleSavePassword}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
              >
                {savingPwd ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}

        {view === "about" && (
          <div className="space-y-3 text-foreground">
            <h3 className="text-lg font-semibold">Sobre</h3>
            <div className="rounded-lg bg-secondary p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Aplicativo</span><strong>LN TV</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Versão</span><strong>{appInfo?.version ?? "..."}</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Build</span><strong>{appInfo?.build ?? "..."}</strong></div>
            </div>
            <p className="text-xs text-muted-foreground text-center pt-2">Pressione OK ou Voltar para retornar</p>
          </div>
        )}
      </div>

      {view === "change-pin-current" && (
        <PinPrompt
          title="Confirme o PIN atual"
          description="Digite o PIN atual pra autorizar a troca"
          expectedPin={currentPin}
          onSubmit={() => setView("change-pin-new")}
          onCancel={() => setView("menu")}
        />
      )}

      {view === "change-pin-new" && (
        <PinPrompt
          title="Novo PIN parental"
          description="Escolha 4 dígitos — será pedido ao abrir canais adultos"
          onSubmit={async (newPin) => {
            const { error } = await supabase
              .from("profiles")
              .update({ adult_pin: newPin })
              .eq("user_id", userId);
            if (error) {
              toast.error("Erro: " + error.message);
            } else {
              setCurrentPin(newPin);
              toast.success("PIN atualizado!");
              setView("menu");
            }
          }}
          onCancel={() => setView("menu")}
        />
      )}
    </div>
  );
}
