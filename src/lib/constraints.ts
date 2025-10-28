import type { Constraint } from '@/lib/csp';

export type RawJobItem = {
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

export type SearchConstraints = {
  refinedInput?: {
    keyword?: string[];
    location?: string;
  };
  mustHaveSkills?: string[];
  keywords?: string[]; // alternative source of keywords
};

// Normaliza texto para comparação robusta: minúsculas, remove acentos
function normalizeBase(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Remove espaços e hífens para capturar variações "fullstack" vs "full stack" vs "full-stack"
function collapseSpaceHyphen(s: string): string {
  return s.replace(/[\s-]+/g, '');
}

function includesNormalized(text: string, token: string): boolean {
  const t = normalizeBase(text);
  const k = normalizeBase(token);
  if (t.includes(k)) return true;
  return collapseSpaceHyphen(t).includes(collapseSpaceHyphen(k));
}

function phraseTokens(phrase: string): string[] {
  return normalizeBase(phrase).split(/[\s-]+/).filter(Boolean);
}

// Uma frase é satisfeita se todos os seus tokens aparecerem (com normalização) no texto
function phraseSatisfied(text: string, phrase: string): boolean {
  const tokens = phraseTokens(phrase);
  if (tokens.length === 0) return false;
  return tokens.every((tok) => includesNormalized(text, tok));
}

// Pelo menos uma frase (keyword) precisa ser satisfeita
function textMatchesAnyPhrase(text: string, phrases: string[]): boolean {
  const hay = text || '';
  return phrases.some((p) => phraseSatisfied(hay, p));
}

// Todas as frases (skills) precisam ser satisfeitas
function textMatchesAllPhrases(text: string, phrases: string[]): boolean {
  const hay = text || '';
  return phrases.every((p) => phraseSatisfied(hay, p));
}

export function makeJobConstraints(c: SearchConstraints): Constraint<RawJobItem>[] {
  const constraints: Constraint<RawJobItem>[] = [];

  const loc = c.refinedInput?.location?.trim();
  if (loc) {
    constraints.push({
      id: 'location',
      label: `Localização: ${loc}`,
      check: (job: RawJobItem) => {
        const inLoc = job.location || job.city || '';
        return inLoc.toLowerCase().includes(loc.toLowerCase());
      },
    });
  }

  // Prioriza keywords vindas diretamente do prompt; se ausentes, usa refinedInput.keyword
  const keywords = (c.keywords && c.keywords.length > 0)
    ? c.keywords
    : (c.refinedInput?.keyword || []);
  if (keywords.length > 0) {
    constraints.push({
      id: 'keywords',
      label: `Palavras-chave: ${keywords.join(', ')}`,
      check: (job: RawJobItem) => {
        const hay = `${job.title ?? job.position ?? ''} ${job.description ?? job.snippet ?? ''}`;
        // Uma das frases deve ser satisfeita (tokens presentes, com variações de espaço/hífen)
        return textMatchesAnyPhrase(hay, keywords);
      },
    });
  }

  const skills = c.mustHaveSkills || [];
  if (skills.length > 0) {
    constraints.push({
      id: 'skills',
      label: `Competências obrigatórias: ${skills.join(', ')}`,
      check: (job: RawJobItem) => {
        const hay = `${job.title ?? job.position ?? ''} ${job.description ?? job.snippet ?? ''}`;
        // Todas as frases de skills devem ser satisfeitas
        return textMatchesAllPhrases(hay, skills);
      },
    });
  }

  return constraints;
}