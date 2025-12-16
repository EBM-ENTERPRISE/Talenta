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
  // Competências técnicas do candidato (usadas para match com a vaga)
  mustHaveSkills?: string[];
  // Palavras-chave/cargo desejado
  keywords?: string[]; // alternative source of keywords
  // Cargo específico (quando disponível)
  role?: string;
  // Experiência do candidato
  candidateExperienceYears?: number; // p.ex. 3
  candidateExperienceLevel?: 'junior' | 'medio' | 'senior';
  // Mínimo de competências técnicas que devem aparecer na vaga (R3)
  kTechMin?: number; // default: 1
  // Soft skills do candidato (desejáveis)
  softSkills?: string[];
  softSkillsThreshold?: number; // default: 0.4 (40%)
  // Localização: pode ser obrigatória ou opcional
  locationPriority?: 'required' | 'optional';
  // Modalidade desejada (remoto, híbrido, presencial)
  modality?: 'remoto' | 'hibrido' | 'presencial';
  modalityRequired?: boolean; // default false
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

// Mapeamento de níveis de experiência
function normalizeLevel(s: string): 'junior' | 'medio' | 'senior' | null {
  const t = normalizeBase(s);
  if (/junior|jr/.test(t)) return 'junior';
  if (/medio|pleno|mid/.test(t)) return 'medio';
  if (/senior|sr|senioridade/.test(t)) return 'senior';
  return null;
}

function extractRequiredMinYears(text: string): number | null {
  const hay = normalizeBase(text);
  const m = hay.match(/(\d+)\s*\+?\s*(anos|year)/);
  if (m) {
    const years = parseInt(m[1], 10);
    return Number.isFinite(years) ? years : null;
  }
  // padrões como "2 a 3 anos"
  const r = hay.match(/(\d+)\s*(a|-|–|—)\s*(\d+)\s*anos/);
  if (r) {
    const min = parseInt(r[1], 10);
    return Number.isFinite(min) ? min : null;
  }
  return null;
}

function extractRequiredLevel(text: string): 'junior' | 'medio' | 'senior' | null {
  const lvl = normalizeLevel(text);
  if (lvl) return lvl;
  // tenta procurar palavras em todo o texto
  const hay = normalizeBase(text);
  if (/junior|jr/.test(hay)) return 'junior';
  if (/medio|pleno|mid/.test(hay)) return 'medio';
  if (/senior|sr|senioridade/.test(hay)) return 'senior';
  return null;
}

function modalityMatches(text: string, desired: 'remoto' | 'hibrido' | 'presencial'): boolean {
  const hay = normalizeBase(text);
  if (desired === 'remoto') return /remoto|remote|home\s*office/.test(hay);
  if (desired === 'hibrido') return /hibrido|hybrid/.test(hay);
  if (desired === 'presencial') return /presencial|on\s*site|onsite/.test(hay);
  return false;
}

export function makeJobConstraints(c: SearchConstraints): Constraint<RawJobItem>[] {
  const constraints: Constraint<RawJobItem>[] = [];

  // R1 — Consistência de cargo (Obrigatória)
  const rolePhrase = (c.role && c.role.trim()) || undefined;
  const keywords = (c.keywords && c.keywords.length > 0)
    ? c.keywords
    : (c.refinedInput?.keyword || []);
  if (rolePhrase) {
    constraints.push({
      id: 'role',
      label: `Cargo: ${rolePhrase}`,
      mandatory: true,
      check: (job: RawJobItem) => {
        const hay = `${job.title ?? job.position ?? ''} ${job.description ?? job.snippet ?? ''}`;
        return phraseSatisfied(hay, rolePhrase);
      },
    });
  } else if (keywords.length > 0) {
    constraints.push({
      id: 'role_keywords',
      label: `Palavras-chave (cargo): ${keywords.join(', ')}`,
      mandatory: true,
      check: (job: RawJobItem) => {
        const hay = `${job.title ?? job.position ?? ''} ${job.description ?? job.snippet ?? ''}`;
        // Pelo menos uma frase de keywords deve ser satisfeita
        return textMatchesAnyPhrase(hay, keywords);
      },
    });
  }

  // R2 — Experiência mínima (Obrigatória): candidato >= mínimo requerido
  if (typeof c.candidateExperienceYears === 'number' || c.candidateExperienceLevel) {
    constraints.push({
      id: 'experience',
      label: `Experiência mínima adequada ao candidato`,
      mandatory: true,
      check: (job: RawJobItem) => {
        const hay = `${job.title ?? job.position ?? ''} ${job.description ?? job.snippet ?? ''}`;
        const reqYears = extractRequiredMinYears(hay);
        const reqLevel = extractRequiredLevel(hay);

        // Se a vaga não especifica claramente, considera ok
        if (reqYears == null && reqLevel == null) return true;

        // Por anos
        if (typeof c.candidateExperienceYears === 'number' && reqYears != null) {
          return c.candidateExperienceYears >= reqYears;
        }

        // Por nível
        if (c.candidateExperienceLevel && reqLevel) {
          const order = { junior: 0, medio: 1, senior: 2 } as const;
          return order[c.candidateExperienceLevel] >= order[reqLevel];
        }

        // Se só um dos lados tem indicador, considera ok
        return true;
      },
    });
  }

  // R3 — Competências Técnicas (Obrigatória): pelo menos k
  const techSkills = c.mustHaveSkills || [];
  const kTech = typeof c.kTechMin === 'number' && c.kTechMin > 0 ? c.kTechMin : (techSkills.length > 0 ? 1 : 0);
  if (techSkills.length > 0 && kTech > 0) {
    constraints.push({
      id: 'tech_skills',
      label: `Competências técnicas (≥${kTech}): ${techSkills.join(', ')}`,
      mandatory: true,
      check: (job: RawJobItem) => {
        const hay = `${job.title ?? job.position ?? ''} ${job.description ?? job.snippet ?? ''}`;
        let count = 0;
        for (const s of techSkills) {
          if (phraseSatisfied(hay, s)) count++;
        }
        return count >= kTech;
      },
    });
  }

  // R4 — Soft Skills (Desejável): >= threshold
  const softSkills = c.softSkills || [];
  const softThr = typeof c.softSkillsThreshold === 'number' && c.softSkillsThreshold > 0 ? c.softSkillsThreshold : 0.4;
  if (softSkills.length > 0) {
    constraints.push({
      id: 'soft_skills',
      label: `Soft skills (≥${Math.round(softThr * 100)}%): ${softSkills.join(', ')}`,
      mandatory: false,
      check: (job: RawJobItem) => {
        const hay = `${job.title ?? job.position ?? ''} ${job.description ?? job.snippet ?? ''}`;
        let count = 0;
        for (const s of softSkills) {
          if (phraseSatisfied(hay, s)) count++;
        }
        const ratio = softSkills.length > 0 ? count / softSkills.length : 0;
        return ratio >= softThr;
      },
    });
  }

  // R5 — Localização (Obrigatória ou Opcional)
  const loc = c.refinedInput?.location?.trim();
  if (loc) {
    constraints.push({
      id: 'location',
      label: `Localização: ${loc}`,
      mandatory: (c.locationPriority === 'required'),
      check: (job: RawJobItem) => {
        const inLoc = job.location || job.city || '';
        const hay = normalizeBase(inLoc).replace(/[,]+/g, ' ');
        const tokens = normalizeBase(loc).replace(/[,]+/g, ' ').split(/[\s-]+/).filter(Boolean);
        return tokens.every((t) => includesNormalized(hay, t));
      },
    });
  }

  // Modalidade (Opcional por padrão)
  if (c.modality) {
    constraints.push({
      id: 'modality',
      label: `Modalidade: ${c.modality}`,
      mandatory: !!c.modalityRequired,
      check: (job: RawJobItem) => {
        const hay = `${job.title ?? job.position ?? ''} ${job.description ?? job.snippet ?? ''}`;
        return modalityMatches(hay, c.modality!);
      },
    });
  }

  return constraints;
}

export type RawProfileItem = {
  firstName?: string;
  lastName?: string;
  name?: string;
  headline?: string;
  location?: string | { parsed?: { text?: string } } | { linkedinText?: string };
  profileLocation?: unknown;
  geo?: unknown;
  currentPosition?: Array<{ position?: string; companyName?: string; location?: string }>;
};

export function makeProfileConstraints(c: SearchConstraints): Constraint<RawProfileItem>[] {
  const constraints: Constraint<RawProfileItem>[] = [];

  const keywords = (c.keywords && c.keywords.length > 0)
    ? c.keywords
    : (c.refinedInput?.keyword || []);
  if (keywords.length > 0) {
    constraints.push({
      id: 'profile_keywords',
      label: `Palavras-chave (perfil): ${keywords.join(', ')}`,
      mandatory: true,
      check: (p: RawProfileItem) => {
        const head = p.headline ?? '';
        const curr = Array.isArray(p.currentPosition) && p.currentPosition.length > 0 ? p.currentPosition[0] : undefined;
        const pos = curr?.position ?? '';
        const comp = curr?.companyName ?? '';
        const hay = `${head} ${pos} ${comp}`;
        return textMatchesAnyPhrase(hay, keywords);
      },
    });
  }

  const techSkills = c.mustHaveSkills || [];
  const kTech = typeof c.kTechMin === 'number' && c.kTechMin > 0 ? c.kTechMin : (techSkills.length > 0 ? 1 : 0);
  if (techSkills.length > 0 && kTech > 0) {
    constraints.push({
      id: 'profile_tech_skills',
      label: `Competências técnicas (≥${kTech}): ${techSkills.join(', ')}`,
      mandatory: true,
      check: (p: RawProfileItem) => {
        const head = p.headline ?? '';
        const curr = Array.isArray(p.currentPosition) && p.currentPosition.length > 0 ? p.currentPosition[0] : undefined;
        const pos = curr?.position ?? '';
        const comp = curr?.companyName ?? '';
        const hay = `${head} ${pos} ${comp}`;
        let count = 0;
        for (const s of techSkills) {
          if (phraseSatisfied(hay, s)) count++;
        }
        return count >= kTech;
      },
    });
  }

  const softSkills = c.softSkills || [];
  const softThr = typeof c.softSkillsThreshold === 'number' && c.softSkillsThreshold > 0 ? c.softSkillsThreshold : 0.4;
  if (softSkills.length > 0) {
    constraints.push({
      id: 'profile_soft_skills',
      label: `Soft skills (≥${Math.round(softThr * 100)}%): ${softSkills.join(', ')}`,
      mandatory: false,
      check: (p: RawProfileItem) => {
        const head = p.headline ?? '';
        const curr = Array.isArray(p.currentPosition) && p.currentPosition.length > 0 ? p.currentPosition[0] : undefined;
        const pos = curr?.position ?? '';
        const comp = curr?.companyName ?? '';
        const hay = `${head} ${pos} ${comp}`;
        let count = 0;
        for (const s of softSkills) {
          if (phraseSatisfied(hay, s)) count++;
        }
        const ratio = softSkills.length > 0 ? count / softSkills.length : 0;
        return ratio >= softThr;
      },
    });
  }

  const loc = c.refinedInput?.location?.trim();
  if (loc) {
    constraints.push({
      id: 'profile_location',
      label: `Localização: ${loc}`,
      mandatory: (c.locationPriority === 'required'),
      check: (p: RawProfileItem) => {
        const v = p.location;
        let inLoc = '';
        if (typeof v === 'string') inLoc = v;
        else if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          const parsed = o['parsed'] as Record<string, unknown> | undefined;
          const txt = typeof o['linkedinText'] === 'string' ? (o['linkedinText'] as string) : undefined;
          const ptxt = parsed && typeof parsed['text'] === 'string' ? (parsed['text'] as string) : undefined;
          inLoc = ptxt || txt || '';
        }
        if (!inLoc) {
          const curr = Array.isArray(p.currentPosition) && p.currentPosition.length > 0 ? p.currentPosition[0] : undefined;
          inLoc = curr?.location ?? '';
        }
        const hay = normalizeBase(inLoc).replace(/[,]+/g, ' ');
        const tokens = normalizeBase(loc).replace(/[,]+/g, ' ').split(/[\s-]+/).filter(Boolean);
        return tokens.every((t) => includesNormalized(hay, t));
      },
    });
  }

  if (typeof c.candidateExperienceYears === 'number' && c.candidateExperienceYears > 0) {
    constraints.push({
      id: 'profile_experience',
      label: `Experiência mínima: ${c.candidateExperienceYears} anos`,
      mandatory: true,
      check: (p: RawProfileItem) => {
        const head = p.headline ?? '';
        const curr = Array.isArray(p.currentPosition) && p.currentPosition.length > 0 ? p.currentPosition[0] : undefined;
        const pos = curr?.position ?? '';
        const comp = curr?.companyName ?? '';
        const hay = `${head} ${pos} ${comp}`;
        const years = extractRequiredMinYears(hay);
        if (years == null) return false;
        return years >= c.candidateExperienceYears!;
      },
    });
  }

  return constraints;
}