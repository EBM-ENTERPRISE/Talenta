import { useState } from "react";
import { PanelLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import SearchHistory from "./SearchHistory";

type SearchResult = {
  id: string;
  search_id: string;
  target_type: string;
  target_id: string;
  rank: number;
  data: Record<string, unknown>;
};

interface SearchSidebarProps {
  onSearchSelect?: (prompt: string) => void;
  onResultsSelect?: (searchId: string, results: SearchResult[]) => void;
}

const SearchSidebar = ({ onSearchSelect, onResultsSelect }: SearchSidebarProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleSearchSelect = (prompt: string) => {
    onSearchSelect?.(prompt);
    if (isMobile) {
      setIsOpen(false);
    }
  };

  const handleResultsSelect = (searchId: string, results: SearchResult[]) => {
    onResultsSelect?.(searchId, results);
    if (isMobile) {
      setIsOpen(false);
    }
  };

  // Mobile version using Sheet
  if (isMobile) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="h-9 w-9"
        >
          <PanelLeft className="h-4 w-4" />
          <span className="sr-only">Abrir histórico de pesquisas</span>
        </Button>

        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="p-6 pb-4">
              <div className="flex items-center justify-between">
                <SheetTitle>Histórico de Pesquisas</SheetTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                  className="h-6 w-6"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </SheetHeader>
            <div className="px-6 pb-6">
              <SearchHistory onSearchSelect={handleSearchSelect} onResultsSelect={handleResultsSelect} />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Desktop version with fixed sidebar
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="h-9 w-9"
      >
        <PanelLeft className="h-4 w-4" />
        <span className="sr-only">Toggle histórico de pesquisas</span>
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Sidebar */}
          <div className="fixed left-0 top-0 h-full w-80 bg-background border-r border-border z-50 shadow-lg">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-lg font-semibold">Histórico de Pesquisas</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="p-6 overflow-y-auto h-[calc(100vh-80px)]">
              <SearchHistory onSearchSelect={handleSearchSelect} onResultsSelect={handleResultsSelect} />
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default SearchSidebar;