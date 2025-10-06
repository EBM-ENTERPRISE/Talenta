import { Search } from "lucide-react";

const TalentaLogo = () => {
  return (
    <div className="flex items-center gap-2">
      <Search className="w-8 h-8 text-foreground" strokeWidth={2.5} />
      <span className="text-xl font-semibold text-foreground">TALENTA</span>
    </div>
  );
};

export default TalentaLogo;
