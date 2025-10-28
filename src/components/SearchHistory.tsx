import { useEffect, useState } from "react";
import { Clock, Search, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type SearchRecord = {
  id: string;
  prompt: string;
  status: "pending" | "running" | "done" | "failed";
  created_at: string;
  constraints?: {
    count?: number;
    refinedInput?: {
      keyword?: string[];
      location?: string;
    };
  };
};

type SearchResult = {
  id: string;
  search_id: string;
  target_type: string;
  target_id: string;
  rank: number;
  data: Record<string, unknown>;
};

interface SearchHistoryProps {
  onSearchSelect?: (prompt: string) => void;
  onResultsSelect?: (searchId: string, results: SearchResult[]) => void;
}

const SearchHistory = ({ onSearchSelect, onResultsSelect }: SearchHistoryProps) => {
  const [searches, setSearches] = useState<SearchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingResults, setLoadingResults] = useState<string | null>(null);

  const fetchSearches = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSearches([]);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("searches")
        .select("id, prompt, status, created_at, constraints")
        .eq("target", "job")
        .order("created_at", { ascending: false })
        .limit(20);

      if (fetchError) {
        console.error("[SearchHistory] fetch error:", fetchError);
        setError("Erro ao carregar histórico");
        return;
      }

      setSearches(data || []);
      
      // Debug: Check how many results exist for each search
      if (data && data.length > 0) {
        console.log('[SearchHistory] Checking search results count for each search...');
        for (const search of data) {
          const { data: resultsData, error: resultsError } = await supabase
            .from("search_results")
            .select("id")
            .eq("search_id", search.id);
          
          console.log(`[SearchHistory] Search ${search.id} (${search.status}): ${resultsData?.length || 0} results`);
        }
      }
    } catch (err) {
      console.error("[SearchHistory] exception:", err);
      setError("Erro inesperado");
    } finally {
      setLoading(false);
    }
  };

  const fetchSearchResults = async (search: SearchRecord) => {
    try {
      console.log('[SearchHistory] fetchSearchResults called for searchId:', search.id);
      setLoadingResults(search.id);
      
      const { data, error: fetchError } = await supabase
        .from("search_results")
        .select("*")
        .eq("search_id", search.id)
        .order("rank", { ascending: true });

      console.log('[SearchHistory] fetchSearchResults response:', {
        searchId: search.id,
        dataCount: data?.length || 0,
        error: fetchError,
        hasOnResultsSelect: !!onResultsSelect
      });

      if (fetchError) {
        console.error("[SearchHistory] fetch results error:", fetchError);
        return;
      }

      // Prefer mostrar resultados salvos. Se não houver, faz fallback para nova busca
      if (data && data.length > 0) {
        if (onResultsSelect) {
          console.log('[SearchHistory] Calling onResultsSelect with', data.length, 'results');
          onResultsSelect(search.id, data);
        }
      } else {
        console.log('[SearchHistory] No saved results found, falling back to new search');
        onSearchSelect?.(search.prompt);
      }
    } catch (err) {
      console.error("[SearchHistory] exception fetching results:", err);
    } finally {
      setLoadingResults(null);
    }
  };

  useEffect(() => {
    fetchSearches();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        fetchSearches();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const getStatusBadge = (status: SearchRecord["status"]) => {
    switch (status) {
      case "done":
        return <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100">Concluída</Badge>;
      case "running":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Em execução</Badge>;
      case "failed":
        return <Badge variant="destructive">Falhou</Badge>;
      case "pending":
        return <Badge variant="outline">Pendente</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) {
      return "Há poucos minutos";
    } else if (diffHours < 24) {
      return `Há ${diffHours}h`;
    } else if (diffDays < 7) {
      return `Há ${diffDays} dias`;
    } else {
      return date.toLocaleDateString("pt-PT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
    }
  };

  const getSearchDetails = (search: SearchRecord) => {
    const constraints = search.constraints;
    const details: string[] = [];
    
    if (constraints?.refinedInput?.location) {
      details.push(constraints.refinedInput.location);
    }
    
    if (constraints?.count !== undefined) {
      details.push(`${constraints.count} resultados`);
    }
    
    return details.join(" • ");
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4 w-4" />
          <h3 className="font-medium">Pesquisas Recentes</h3>
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4 w-4" />
          <h3 className="font-medium">Pesquisas Recentes</h3>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={fetchSearches}
          className="w-full"
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (searches.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4 w-4" />
          <h3 className="font-medium">Pesquisas Recentes</h3>
        </div>
        <div className="text-sm text-muted-foreground text-center py-4">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Nenhuma pesquisa encontrada</p>
          <p className="text-xs mt-1">Faça uma pesquisa para ver o histórico aqui</p>
        </div>
      </div>
    );
  }

  const handleSearchClick = (search: SearchRecord) => {
    console.log('[SearchHistory] handleSearchClick called', {
      searchId: search.id,
      status: search.status,
      prompt: search.prompt,
      hasOnResultsSelect: !!onResultsSelect,
      hasOnSearchSelect: !!onSearchSelect
    });

    // Sempre tenta carregar resultados salvos primeiro; se vier vazio, faz nova busca
    fetchSearchResults(search);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="h-4 w-4" />
        <h3 className="font-medium">Pesquisas Recentes</h3>
      </div>
      
      <div className="space-y-2">
        {searches.map((search) => (
          <div
            key={search.id}
            className={`group p-3 rounded-lg border border-border/50 hover:border-border hover:bg-accent/50 transition-colors cursor-pointer ${
              loadingResults === search.id ? 'opacity-50 pointer-events-none' : ''
            }`}
            onClick={() => handleSearchClick(search)}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors">
                  {search.prompt}
                </p>
                <div className="flex items-center gap-1">
                  {loadingResults === search.id && (
                    <div className="animate-spin h-3 w-3 border border-primary border-t-transparent rounded-full" />
                  )}
                  {getStatusBadge(search.status)}
                </div>
              </div>
              
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatDate(search.created_at)}</span>
                {getSearchDetails(search) && (
                  <span className="truncate ml-2">{getSearchDetails(search)}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {searches.length >= 20 && (
        <div className="text-xs text-muted-foreground text-center pt-2">
          Mostrando as 20 pesquisas mais recentes
        </div>
      )}
    </div>
  );
};

export default SearchHistory;