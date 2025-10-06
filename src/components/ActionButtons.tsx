import { Button } from "@/components/ui/button";

const ActionButtons = () => {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <Button 
        variant="secondary"
        className="h-12 px-8 text-base font-medium bg-white hover:bg-white/90 text-foreground rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.05)] transition-all hover:scale-105"
      >
        Procurar candidatos
      </Button>
      <Button 
        variant="secondary"
        className="h-12 px-8 text-base font-medium bg-white hover:bg-white/90 text-foreground rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.05)] transition-all hover:scale-105"
      >
        Encontrar Vagas
      </Button>
      <Button 
        variant="secondary"
        className="h-12 px-8 text-base font-medium bg-white hover:bg-white/90 text-foreground rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.05)] transition-all hover:scale-105"
      >
        Gerar lista de Empresas
      </Button>
    </div>
  );
};

export default ActionButtons;
