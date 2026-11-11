/**
 * ============================================================================
 * MÓDULO ACCOUNT WARMUP: PLANEJADOR DE LOTE DIÁRIO & NOVAS CONTAS
 * ============================================================================
 * Diretório: modules/account_warmup/batch_planner.js
 * 
 * Permite ao operador emitir o comando mestre:
 * "Analise e planeje o lote de amanhã e aquecimento + novas contas diário"
 * 
 * Funções:
 * 1. Audita todas as contas do pipeline (warming_accounts_pipeline.json).
 * 2. Cruza com o cofre (.env.vault.json) e perfis do MultiZen C++.
 * 3. Classifica as contas por nível de autonomia:
 *    - 100% Autônomas (Senha + 2FA TOTP: zero necessidade de celular)
 *    - Supervisionadas (Exigem celular por perto para SMS ou Google Tap)
 *    - Vagas Disponíveis (Espaços livres para novas contas / chips 4G)
 * 4. Gera o cronograma estimado com respeito ao túnel 4G.
 * ============================================================================
 */

const vault = require('../common/vault');
const { loadPipeline } = require('./lifecycle_pipeline');

function analyzeBatchForTomorrow(options = {}) {
  const pipelineData = loadPipeline();

  const rawAccounts = Array.isArray(pipelineData.accounts) ? pipelineData.accounts : [];

  const autonomousBatch = [];
  const supervisedBatch = [];
  const emptySlots = [];
  const graduatedBatch = [];

  for (const acc of rawAccounts) {
    const full = vault.getAccountWithDecryptedVaultSecrets(acc);
    const email = String(full.email || '').trim();
    const hasPassword = Boolean(full.password);
    const hasTotp = Boolean(full.google_totp_secret || full.totp_secret);
    const hasRecovery = Boolean(full.recovery_email);
    const dia1Done = Boolean(full.warmup_stats && full.warmup_stats.dia1_completed);
    const newsCount = (full.warmup_stats && Array.isArray(full.warmup_stats.newsletters_subscribed))
      ? full.warmup_stats.newsletters_subscribed.length
      : 0;

    if (!email || !hasPassword) {
      emptySlots.push({
        id: full.id,
        name: full.name || 'Slot Vazio',
        profile_id: full.incogniton_profile_id || null,
        browser_engine: full.browser_engine || 'multizen_cloak_cpp'
      });
      continue;
    }

    const item = {
      id: full.id,
      name: full.name,
      email,
      profile_id: full.incogniton_profile_id,
      browser_engine: full.browser_engine || 'multizen_cloak_cpp',
      has_totp: hasTotp,
      has_recovery: hasRecovery,
      dia1_completed: dia1Done,
      newsletters_count: newsCount,
      warmup_mode: full.warmup_mode || 'EMAIL_ONLY_PREWARM'
    };

    if (dia1Done) {
      graduatedBatch.push(item);
    } else if (hasTotp) {
      autonomousBatch.push(item);
    } else {
      supervisedBatch.push(item);
    }
  }

  // Estimativa de tempo: ~5 minutos por conta (login + inbox + 15 newsletters)
  const totalToWarm = autonomousBatch.length + supervisedBatch.length;
  const estimatedDurationMinutes = totalToWarm * 5;
  const estimatedDurationHours = (estimatedDurationMinutes / 60).toFixed(1);

  return {
    total_pipeline_accounts: rawAccounts.length,
    active_accounts_to_warm: totalToWarm,
    estimated_duration_minutes: estimatedDurationMinutes,
    estimated_duration_hours: estimatedDurationHours,
    summary: {
      autonomous_count: autonomousBatch.length,
      supervised_count: supervisedBatch.length,
      graduated_count: graduatedBatch.length,
      empty_slots_count: emptySlots.length
    },
    batches: {
      autonomous_batch: autonomousBatch,
      supervised_batch: supervisedBatch,
      graduated_batch: graduatedBatch,
      empty_slots: emptySlots
    }
  };
}

function printBatchPlan() {
  const plan = analyzeBatchForTomorrow();

  console.log('\n============================================================');
  console.log('📋 PLANO DO LOTE DE AMANHÃ: AQUECIMENTO GMAIL + NOVAS CONTAS');
  console.log('============================================================');
  console.log(`Total de Contas no Pipeline:   ${plan.total_pipeline_accounts}`);
  console.log(`Contas a Aquecer Amanhã:       ${plan.active_accounts_to_warm}`);
  console.log(`Tempo Estimado Total:          ~${plan.estimated_duration_minutes} min (~${plan.estimated_duration_hours}h)`);

  console.log('\n🟢 1. LOTE 100% AUTÔNOMO (RODA SOZINHO • SENHA + 2FA TOTP NO COFRE):');
  if (plan.batches.autonomous_batch.length === 0) {
    console.log('   (Nenhuma conta com chave TOTP cadastrada ainda)');
  } else {
    plan.batches.autonomous_batch.forEach((a, i) => {
      console.log(`   [${String(i + 1).padStart(2, '0')}] ${a.email.padEnd(30)} | Perfil: ${a.profile_id.slice(0, 8)}... | 2FA: AUTO`);
    });
  }

  console.log('\n🟡 2. LOTE SUPERVISIONADO (ATENÇÃO AO CELULAR • PODE PEDIR SMS / PROMPT):');
  if (plan.batches.supervised_batch.length === 0) {
    console.log('   (Nenhuma conta pendente de supervisão)');
  } else {
    plan.batches.supervised_batch.forEach((a, i) => {
      const recTag = a.has_recovery ? 'Recuperação: OK' : 'Sem Recup';
      console.log(`   [${String(i + 1).padStart(2, '0')}] ${a.email.padEnd(30)} | Perfil: ${a.profile_id.slice(0, 8)}... | ${recTag}`);
    });
  }

  console.log('\n⚪ 3. VAGAS LIVRES P/ NOVAS CONTAS (CHIPS 4G / CADASTRO):');
  console.log(`   ${plan.batches.empty_slots.length} vagas prontas no MultiZen C++ aguardando novos e-mails.`);

  console.log('\n💡 RECOMENDAÇÃO OPERACIONAL PARA O TURNO DE AMANHÃ:');
  console.log('   1. Rodar primeiro o Lote 100% Autônomo com rotação 4G a cada conta.');
  console.log('   2. Para o Lote Supervisionado, ter o celular com os chips 4G por perto caso o Google peça SMS.');
  console.log('   3. Se uma conta pedir SMS, o robô alerta imediatamente sem travar o restante do lote.');
  console.log('============================================================\n');
}

if (require.main === module) {
  printBatchPlan();
}

module.exports = {
  analyzeBatchForTomorrow,
  printBatchPlan
};
