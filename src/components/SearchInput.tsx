import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Mic, ArrowUp, Globe } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface SearchInputProps {
  onSubmit: (prompt: string) => void;
}

const SearchInput = ({ onSubmit }: SearchInputProps) => {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = () => {
    if (prompt.trim()) {
      onSubmit(prompt);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="bg-white rounded-3xl shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Procure por uma vaga..."
          className="min-h-[80px] border-0 resize-none text-lg focus-visible:ring-0 placeholder:text-muted-foreground bg-transparent"
        />
        
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full hover:bg-accent"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 rounded-full gap-2 bg-background/50"
            >
              <Globe className="h-4 w-4" />
              <span className="text-sm">Public</span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full hover:bg-accent"
            >
              <Mic className="h-4 w-4" />
            </Button>
            
            <Button
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              size="icon"
              className="h-9 w-9 rounded-full bg-foreground hover:bg-foreground/90 text-background disabled:opacity-50"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchInput;
