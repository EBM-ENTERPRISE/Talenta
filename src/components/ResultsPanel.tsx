import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Briefcase, Star } from "lucide-react";

interface JobResult {
  title?: string;
  companyName?: string;
  location?: string;
  description?: string;
  applyUrl?: string;
  postedAt?: string;
}

type RawJobItem = {
  title?: string;
  position?: string;
  companyName?: string;
  company?: string;
  location?: string;
  city?: string;
  description?: string;
  snippet?: string;
  applyUrl?: string;
  url?: string;
  link?: string;
  postedAt?: string;
  datePosted?: string;
};

const ResultsPanel = ({ results = [], loading = false }: { results?: RawJobItem[]; loading?: boolean }) => {
  const [internalResults, setInternalResults] = useState<JobResult[]>([]);

  useEffect(() => {
    if (Array.isArray(results) && results.length > 0) {
      const mapped = results.map((item: RawJobItem) => ({
        title: item.title ?? item.position ?? "Vaga",
        companyName: item.companyName ?? item.company ?? "Empresa",
        location: item.location ?? item.city ?? "Localização não informada",
        description: item.description ?? item.snippet ?? "",
        applyUrl: item.applyUrl ?? item.url ?? item.link ?? "#",
        postedAt: item.postedAt ?? item.datePosted ?? "",
      }));
      setInternalResults(mapped);
    } else {
      setInternalResults([]);
    }
  }, [results]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <h3 className="text-xl font-semibold text-foreground mb-2">
          A procurar vagas no LinkedIn...
        </h3>
        <p className="text-foreground/60 text-center max-w-md">
          Estamos a varrer as vagas e preparar os resultados.
        </p>
      </div>
    );
  }

  if (internalResults.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <h3 className="text-xl font-semibold text-foreground mb-2">
          Sem resultados ainda
        </h3>
        <p className="text-foreground/60 text-center max-w-md">
          Tente ajustar palavras-chave ou localização.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {internalResults.length} Vagas Encontradas
          </h2>
          <p className="text-foreground/70">
            Resultados ordenados por relevância
          </p>
        </div>

        <div className="space-y-4">
          {internalResults.map((job, index) => (
            <Card
              key={`${job.title}-${job.companyName}-${index}`}
              className="p-6 hover:shadow-lg transition-all duration-300 animate-fade-in border-border/40"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-foreground mb-1">
                    {job.title}
                  </h3>
                  <p className="text-foreground/80 mb-2">{job.companyName}</p>
                  
                  <div className="flex items-center gap-4 text-sm text-foreground/60">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      {job.location}
                    </span>
                    {job.postedAt && (
                      <span className="flex items-center gap-1">
                        <Briefcase className="h-4 w-4" />
                        Publicada: {job.postedAt}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 bg-primary/10 px-3 py-2 rounded-full">
                  <Star className="h-4 w-4 text-primary fill-primary" />
                  <span className="font-semibold text-primary">
                    90%
                  </span>
                </div>
              </div>

              {job.description && (
                <p className="text-foreground/70 mb-3 line-clamp-4">{job.description}</p>
              )}

              {job.applyUrl && (
                <a
                  href={job.applyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline text-sm"
                >
                  Candidatar-se
                </a>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ResultsPanel;
