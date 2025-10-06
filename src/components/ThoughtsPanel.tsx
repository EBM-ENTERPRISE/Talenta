import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import SearchInput from "./SearchInput";

interface ThoughtStep {
  id: number;
  text: string;
  completed: boolean;
}

interface ThoughtsPanelProps {
  onNewPrompt?: (prompt: string) => void;
}

const ThoughtsPanel = ({ onNewPrompt }: ThoughtsPanelProps) => {
  const [steps, setSteps] = useState<ThoughtStep[]>([]);

  useEffect(() => {
    const thoughtSteps = [
      { id: 1, text: "Analisando o pedido...", completed: false },
      { id: 2, text: "Conectando ao LinkedIn...", completed: false },
      { id: 3, text: "Pesquisando perfis relevantes...", completed: false },
      { id: 4, text: "Filtrando resultados...", completed: false },
      { id: 5, text: "Organizando dados...", completed: false },
    ];

    thoughtSteps.forEach((step, index) => {
      setTimeout(() => {
        setSteps((prev) => [...prev, { ...step, completed: false }]);
        
        setTimeout(() => {
          setSteps((prev) =>
            prev.map((s) => (s.id === step.id ? { ...s, completed: true } : s))
          );
        }, 800);
      }, index * 1200);
    });
  }, []);

  return (
    <div className="w-80 bg-background/50 backdrop-blur-sm border-r border-border/40 p-6 overflow-y-auto flex flex-col">
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-foreground/70 mb-4 uppercase tracking-wide">
          Processando
        </h3>
        
        <div className="space-y-3">
          {steps.map((step) => (
            <div
              key={step.id}
              className="flex items-start gap-3 animate-fade-in"
            >
              <div className="mt-1">
                {!step.completed ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                    <svg
                      className="h-3 w-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                )}
              </div>
              <p className={`text-sm ${step.completed ? 'text-foreground/60' : 'text-foreground'}`}>
                {step.text}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-border/40">
        <p className="text-xs text-foreground/60 mb-3 uppercase tracking-wide">
          Ajustar pesquisa
        </p>
        <SearchInput onSubmit={onNewPrompt || (() => {})} />
      </div>
    </div>
  );
};

export default ThoughtsPanel;
