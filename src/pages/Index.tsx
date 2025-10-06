import { Button } from "@/components/ui/button";
import TalentaLogo from "@/components/TalentaLogo";
import SearchInput from "@/components/SearchInput";
import ActionButtons from "@/components/ActionButtons";

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-6 flex items-center justify-between max-w-7xl mx-auto">
        <TalentaLogo />
        <div className="flex items-center gap-3">
          <Button 
            variant="default"
            className="h-11 px-8 bg-primary hover:bg-primary/90 text-foreground rounded-full font-medium transition-all hover:scale-105 shadow-[0_2px_10px_rgba(124,198,255,0.3)]"
          >
            Login
          </Button>
          <Button 
            variant="default"
            className="h-11 px-8 bg-primary hover:bg-primary/90 text-foreground rounded-full font-medium transition-all hover:scale-105 shadow-[0_2px_10px_rgba(124,198,255,0.3)]"
          >
            Registrar
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <div className="w-full max-w-4xl mx-auto text-center space-y-8">
          {/* Heading */}
          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold text-foreground">
              O que procuras hoje?
            </h1>
            <p className="text-lg md:text-xl text-foreground/80 max-w-2xl mx-auto">
              Descreve o tipo de vaga ou o profissional ideal — a TALENTA encontra os melhores resultados para ti.
            </p>
          </div>

          {/* Search Input */}
          <SearchInput />

          {/* Action Buttons */}
          <ActionButtons />
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full px-6 py-6 text-center">
        <p className="text-sm text-foreground/70">
          TALENTA © 2025 — Desenvolvido com inteligência para o futuro do trabalho.
        </p>
      </footer>
    </div>
  );
};

export default Index;
