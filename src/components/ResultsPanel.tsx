import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Briefcase, Star } from "lucide-react";
import type { SearchConstraints } from '@/lib/applyCspToResults';
import type { CspEval } from '@/lib/applyCspToResults';

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

const ResultsPanel = ({ results = [], loading = false, constraints, evaluations }: { results?: RawJobItem[]; loading?: boolean; constraints?: SearchConstraints; evaluations?: CspEval[] }) => {
  const [internalResults, setInternalResults] = useState<JobResult[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;

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
    setPage(1); // reset to first page when results change
  }, [results]);

  const total = internalResults.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageResults = internalResults.slice(start, end);
  const pageEvaluations = evaluations?.slice(start, end) || [];

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
            Resultados ordenados por proximidade
          </p>
          {constraints && (
            <div className="flex flex-wrap gap-2 mt-3">
              {constraints.refinedInput?.location && (
                <Badge variant="secondary">Localização: {constraints.refinedInput.location}</Badge>
              )}
              {(() => {
                const kws = (constraints.keywords && constraints.keywords.length > 0)
                  ? constraints.keywords
                  : (constraints.refinedInput?.keyword || []);
                return Array.isArray(kws) && kws.length > 0 ? (
                  <Badge variant="secondary">Palavras-chave: {kws.join(', ')}</Badge>
                ) : null;
              })()}
              {Array.isArray(constraints.mustHaveSkills) && constraints.mustHaveSkills!.length > 0 && (
                <Badge variant="secondary">Competências: {constraints.mustHaveSkills!.join(', ')}</Badge>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {pageResults.map((job, index) => (
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
                    {pageEvaluations?.[index]?.score ?? 100}%
                   </span>
                 </div>
              </div>

              {job.description && (
                <p className="text-foreground/70 mb-3 line-clamp-4">{job.description}</p>
              )}

              {pageEvaluations && pageEvaluations[index] && pageEvaluations[index].violated.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {pageEvaluations[index].violated.map((label, i) => (
                    <Badge key={i} variant="destructive" className="text-xs">Falha: {label}</Badge>
                  ))}
                </div>
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

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Anterior
            </button>
            <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
            <button
              className="px-3 py-1 rounded border border-border text-sm disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Próxima
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultsPanel;
