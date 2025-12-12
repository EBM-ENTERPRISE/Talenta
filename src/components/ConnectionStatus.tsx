import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { supabase } from '@/lib/supabase';

export const ConnectionStatus = () => {
  const [isOnline, setIsOnline] = useState(true);

  const checkConnection = async () => {
    try {
      // Tenta uma operação leve no Supabase para ver se responde
      // Como não temos uma tabela garantida, vamos apenas checar se a URL base responde (hack simples)
      // Ou melhor, tentar pegar a sessão, que é uma chamada local/remota segura
      const { error } = await supabase.from('jobs').select('count', { count: 'exact', head: true });
      
      // Se der erro de conexão (fetch error), o supabase lança exceção ou retorna erro específico
      if (error && error.message && (error.message.includes('fetch') || error.message.includes('connection'))) {
         setIsOnline(false);
      } else {
         setIsOnline(true);
      }
    } catch (err) {
      // Se cair aqui, é erro de rede/conexão grave
      setIsOnline(false);
    }
  };

  useEffect(() => {
    // Checa a cada 5 segundos
    const interval = setInterval(checkConnection, 5000);
    checkConnection(); // Checa na montagem

    return () => clearInterval(interval);
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md animate-in slide-in-from-bottom-5">
      <Alert variant="destructive" className="border-2 border-red-600 bg-red-50 dark:bg-red-950/90 shadow-lg">
        <AlertCircle className="h-5 w-5" />
        <AlertTitle className="text-lg font-bold ml-2">Erro de Conexão</AlertTitle>
        <AlertDescription className="mt-2 text-sm">
          Não foi possível conectar ao servidor. Verifique se os backends estão ligados.
          <div className="mt-2 text-xs opacity-70">
             Tentando reconectar...
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
};
