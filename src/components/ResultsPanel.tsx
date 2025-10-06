import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Briefcase, Star } from "lucide-react";

interface Result {
  id: number;
  name: string;
  title: string;
  location: string;
  experience: string;
  skills: string[];
  matchScore: number;
}

const mockResults: Result[] = [
  {
    id: 1,
    name: "Maria Silva",
    title: "Senior Frontend Developer",
    location: "Lisboa, Portugal",
    experience: "5+ anos",
    skills: ["React", "TypeScript", "Tailwind CSS", "Node.js"],
    matchScore: 95,
  },
  {
    id: 2,
    name: "João Santos",
    title: "Full Stack Developer",
    location: "Porto, Portugal",
    experience: "3 anos",
    skills: ["React", "Python", "PostgreSQL", "AWS"],
    matchScore: 88,
  },
  {
    id: 3,
    name: "Ana Costa",
    title: "Frontend Engineer",
    location: "Braga, Portugal",
    experience: "4 anos",
    skills: ["Vue.js", "JavaScript", "CSS", "Firebase"],
    matchScore: 82,
  },
];

const ResultsPanel = () => {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
      setResults(mockResults);
    }, 6000);

    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <h3 className="text-xl font-semibold text-foreground mb-2">
          A procurar os melhores profissionais...
        </h3>
        <p className="text-foreground/60 text-center max-w-md">
          Estamos a analisar milhares de perfis no LinkedIn para encontrar as melhores correspondências.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {results.length} Profissionais Encontrados
          </h2>
          <p className="text-foreground/70">
            Resultados ordenados por relevância
          </p>
        </div>

        <div className="space-y-4">
          {results.map((result, index) => (
            <Card
              key={result.id}
              className="p-6 hover:shadow-lg transition-all duration-300 animate-fade-in border-border/40"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-foreground mb-1">
                    {result.name}
                  </h3>
                  <p className="text-foreground/80 mb-2">{result.title}</p>
                  
                  <div className="flex items-center gap-4 text-sm text-foreground/60">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      {result.location}
                    </span>
                    <span className="flex items-center gap-1">
                      <Briefcase className="h-4 w-4" />
                      {result.experience}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 bg-primary/10 px-3 py-2 rounded-full">
                  <Star className="h-4 w-4 text-primary fill-primary" />
                  <span className="font-semibold text-primary">
                    {result.matchScore}%
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {result.skills.map((skill) => (
                  <Badge
                    key={skill}
                    variant="secondary"
                    className="bg-secondary/50"
                  >
                    {skill}
                  </Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ResultsPanel;
