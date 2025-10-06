import { Input } from "@/components/ui/input";

const SearchInput = () => {
  return (
    <div className="w-full max-w-3xl mx-auto">
      <Input
        type="text"
        placeholder="Procure por uma vaga..."
        className="h-16 px-6 text-lg bg-white rounded-3xl shadow-[0_2px_10px_rgba(0,0,0,0.05)] border-0 focus-visible:ring-2 focus-visible:ring-primary placeholder:text-muted-foreground"
      />
    </div>
  );
};

export default SearchInput;
