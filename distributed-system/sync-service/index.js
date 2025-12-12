const { createClient } = require('@supabase/supabase-js');

console.log('🔄 INICIANDO GERENTE DE CONSISTÊNCIA DE DADOS DISTRIBUÍDOS 🔄');
console.log('------------------------------------------------------------');

// Configuração do Supabase 1 (Master A)
const supabase1 = createClient(
  process.env.SUPABASE_URL_1,
  process.env.SUPABASE_KEY_1
);

// Configuração do Supabase 2 (Master B)
const supabase2 = createClient(
  process.env.SUPABASE_URL_2,
  process.env.SUPABASE_KEY_2
);

const SYNC_INTERVAL_MS = 3000; // 3 Segundos para resposta rápida
const TABLES_TO_SYNC = [
  'organizations', 
  'jobs', 
  'skills', 
  'job_skills', 
  'profiles', 
  'education', 
  'experiences'
];

// Ordem de dependência é importante!
// organizations -> jobs
// profiles (depende de users, mas tentaremos) -> education/experiences

async function syncAllTables() {
  console.log(`\n[${new Date().toISOString()}] 🔍 Iniciando Ciclo de Sincronização Completa...`);
  
  for (const table of TABLES_TO_SYNC) {
    await syncTable(table);
  }
}

async function syncTable(tableName) {
  try {
    // 1. Contar registros em ambos
    const { count: count1, error: err1 } = await supabase1.from(tableName).select('*', { count: 'exact', head: true });
    const { count: count2, error: err2 } = await supabase2.from(tableName).select('*', { count: 'exact', head: true });

    if (err1 || err2) {
      console.error(`❌ [${tableName}] Erro de conexão:`, err1?.message || err2?.message);
      return;
    }

    if (count1 === count2) {
      // Se contagem igual, assume sincronizado (otimização simples)
      // Para produção real, verificaríamos updated_at
      return; 
    }

    console.log(`   📊 [${tableName}] Divergência: DB1=${count1} vs DB2=${count2}`);

    // Estratégia Bidirecional Simples (Baseada em IDs faltantes)
    await replicateMissingData(supabase1, supabase2, tableName, 'DB1 -> DB2');
    await replicateMissingData(supabase2, supabase1, tableName, 'DB2 -> DB1');

  } catch (error) {
    console.error(`❌ [${tableName}] Erro fatal:`, error.message);
  }
}

async function replicateMissingData(sourceDb, targetDb, tableName, directionLabel) {
  // Pega TODOS os dados da origem (Para demo isso é ok, para prod usaríamos paginação/cursor)
  const { data: sourceData, error: sourceError } = await sourceDb.from(tableName).select('*');
  if (sourceError) {
    console.error(`   ❌ Erro lendo origem (${directionLabel}):`, sourceError.message);
    return;
  }

  // Pega IDs do destino
  const { data: targetData, error: targetError } = await targetDb.from(tableName).select('id'); // Assumindo chave primária 'id'
  // Nota: job_skills tem chave composta, esse código precisaria de ajuste para chaves compostas
  
  if (targetError) {
     // Se falhar (ex: tabela não tem coluna id), tenta pegar tudo para comparar manual ou pular
     // Para job_skills (job_id, skill_id), precisamos de lógica especial
     if (tableName === 'job_skills' || tableName === 'profile_skills' || tableName === 'organization_members') {
        await syncCompositeKeyTable(sourceDb, targetDb, tableName, directionLabel);
        return;
     }
     console.error(`   ❌ Erro lendo destino (${directionLabel}):`, targetError.message);
     return;
  }

  const targetIds = new Set(targetData.map(r => r.id));
  
  // Filtra o que falta
  const recordsToInsert = sourceData.filter(record => !targetIds.has(record.id));

  if (recordsToInsert.length > 0) {
    console.log(`   🚀 [${tableName}] ${directionLabel}: Replicando ${recordsToInsert.length} itens...`);
    
    // Tenta inserir
    const { error: insertError } = await targetDb.from(tableName).upsert(recordsToInsert);
    
    if (insertError) {
      console.error(`   ❌ [${tableName}] Falha na replicação:`, insertError.message);
      if (tableName === 'profiles' && insertError.message.includes('foreign key constraint')) {
        console.warn('   ⚠️  Aviso: Falha ao sincronizar Profile pois o Usuário (Auth) não existe no destino. Isso é esperado sem chaves de admin.');
      }
    } else {
      console.log(`   ✅ [${tableName}] Sincronizado com sucesso!`);
    }
  }
}

async function syncCompositeKeyTable(sourceDb, targetDb, tableName, directionLabel) {
  // Lógica simplificada para tabelas de ligação (muito custosa para rodar sempre, mas ok para demo pequena)
  // Deleta tudo no destino e insere tudo da origem? Não, perigoso.
  // Apenas ignora para evitar complexidade excessiva no demo, ou tenta upsert cego (Supabase lida com conflito)
  
  const { data: sourceData } = await sourceDb.from(tableName).select('*');
  if (!sourceData || sourceData.length === 0) return;

  // Tenta upsert de tudo (ignora duplicados)
  const { error } = await targetDb.from(tableName).upsert(sourceData, { ignoreDuplicates: true });
  if (error) {
     // Silencia erros de chave duplicada ou FK
  } else {
     // console.log(`   🔄 [${tableName}] ${directionLabel}: Sincronização via Upsert cego concluída.`);
  }
}

// Loop Infinito
setInterval(syncAllTables, SYNC_INTERVAL_MS);
syncAllTables();
