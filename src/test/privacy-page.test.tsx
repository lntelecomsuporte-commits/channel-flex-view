import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyPage from "@/pages/PrivacyPage";

const appSource = readFileSync("src/App.tsx", "utf8");

afterEach(cleanup);

describe("página de privacidade do LN TV", () => {
  it("está publicada em /privacidade sem exigir login", () => {
    const route = appSource.match(
      /<Route path="\/privacidade" element=\{([^}]*)\} \/>/,
    );
    expect(route).not.toBeNull();
    expect(route![1]).toBe("<PrivacyPage />");
    expect(route![1]).not.toContain("ProtectedRoute");
  });

  it("declara os dados coletados, a retenção e o contato", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole("heading", { name: "Política de Privacidade" }),
    ).toBeInTheDocument();
    for (const title of [
      "Dados que coletamos",
      "Retenção e exclusão",
      "Contato",
    ]) {
      expect(
        screen.getByRole("heading", { name: title }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(/Endereço IP/i)).toBeInTheDocument();
    expect(screen.getByText(/DUID/i)).toBeInTheDocument();
  });

  it("afirma que não vende dados e que o app não faz cadastro público", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText("Não vendemos seus dados pessoais."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Canais com conteúdo adulto ficam protegidos por PIN/),
    ).toBeInTheDocument();
  });
});
