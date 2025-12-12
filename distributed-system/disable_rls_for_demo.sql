-- ⚠️ ATENÇÃO: Execute este script no SQL Editor de AMBOS os projetos Supabase
-- Isso desativará a segurança (RLS) para permitir que o Sync Service (que usa chave pública)
-- consiga replicar os dados livremente durante a demonstração.

-- 1. Desabilitar RLS nas tabelas principais
ALTER TABLE public.jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_skills DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.education DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiences DISABLE ROW LEVEL SECURITY;

-- 2. Garantir permissões para a role 'anon' e 'authenticated'
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 3. (Opcional) Se quiser manter RLS, crie policies permissivas:
-- CREATE POLICY "Enable access to all users" ON public.jobs FOR ALL USING (true) WITH CHECK (true);
-- ... repita para outras tabelas
