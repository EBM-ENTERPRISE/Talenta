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

const ResultsPanel = ({ results = [], loading = false, constraints, evaluations, target }: { results?: RawJobItem[] | Record<string, unknown>[]; loading?: boolean; constraints?: SearchConstraints; evaluations?: CspEval[]; target?: "jobs" | "people" }) => {
  const [internalResults, setInternalResults] = useState<JobResult[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    if (Array.isArray(results) && results.length > 0) {
      const sanitize = (s: string) => s.replace(/^\s*[`'"]?\s*/, '').replace(/\s*[`'"]?\s*$/, '');
      const getStr = (v: unknown): string => {
        if (typeof v === 'string') return sanitize(v);
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          const t = o['linkedinText'] || o['text'] || o['name'];
          if (typeof t === 'string') return sanitize(t);
        }
        return '';
      };
      const getLocation = (obj: unknown): string => {
        if (typeof obj === 'string') return sanitize(obj);
        if (obj && typeof obj === 'object') {
          const o = obj as Record<string, unknown>;
          const parsed = o['parsed'] as Record<string, unknown> | undefined;
          const txt = typeof o['linkedinText'] === 'string' ? o['linkedinText'] as string : undefined;
          const ptxt = parsed && typeof parsed['text'] === 'string' ? parsed['text'] as string : undefined;
          return sanitize(ptxt || txt || '');
        }
        return '';
      };
      const mapped = results.map((raw: unknown) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        if (target === 'people') {
          const first = getStr(item['firstName']);
          const last = getStr(item['lastName']);
          const name = (first || last) ? `${first}${first && last ? ' ' : ''}${last}` : (getStr(item['name']) || getStr(item['title']) || 'Perfil');
          const snippet = getStr(item['headline']) || getStr(item['snippet']) || '';
          const directUrl = getStr(item['linkedinUrl']) || getStr(item['profileUrl']) || getStr(item['link']);
          const publicId = getStr(item['publicIdentifier']);
          const profileUrl = directUrl || (publicId ? `https://www.linkedin.com/in/${publicId}` : '#');
          let location = getLocation(item['location']) || getStr(item['location']) || '';
          if (!location) {
            const profLoc = (item['profileLocation'] ?? item['geo']) as unknown;
            location = getLocation(profLoc) || location;
          }
          if (!location) {
            const currPos = Array.isArray(item['currentPosition']) ? (item['currentPosition'] as unknown[]) : [];
            const firstPos = (currPos[0] ?? {}) as Record<string, unknown>;
            location = getStr(firstPos['location']) || location;
          }
          return { title: name, companyName: '', location: location || '—', description: snippet, applyUrl: profileUrl, postedAt: '' } as JobResult;
        }
        const title = getStr(item['title']) || getStr(item['position']) || 'Vaga';
        const companyName = getStr(item['companyName']) || getStr(item['company']) || 'Empresa';
        const location = getStr(item['location']) || getStr(item['city']) || 'Localização não informada';
        const description = getStr(item['description']) || getStr(item['snippet']) || '';
        const applyUrl = getStr(item['applyUrl']) || getStr(item['url']) || getStr(item['link']) || '#';
        const postedAt = getStr(item['postedAt']) || getStr(item['datePosted']) || '';
        return { title, companyName, location, description, applyUrl, postedAt } as JobResult;
      });
      setInternalResults(mapped);
    } else {
      setInternalResults([]);
    }
    setPage(1);
  }, [results, target]);

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
          {target === 'people' ? 'A procurar perfis no LinkedIn...' : 'A procurar vagas no LinkedIn...'}
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
            {internalResults.length} {target === 'people' ? 'Perfis Encontrados' : 'Vagas Encontradas'}
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
                  rel="noopener noreferrer"
                  className="text-primary hover:underline text-sm"
                >
                  {target === 'people' ? 'Ver perfil' : 'Candidatar-se'}
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
