/**
 * End-to-end probe of the permission model, run as a REAL signed-in user.
 *
 *   pnpm rls:probe
 *
 * Why this exists: every check you make with the service-role client passes,
 * because the service role bypasses RLS. It proves nothing. This creates a
 * throwaway auth user, signs in with the anon key like the app does, and tries
 * to break the rules — read without the module, escalate its own perfil, read a
 * colleague's push tokens, delete a company. Then it grants the module and
 * asserts the legitimate paths work.
 *
 * It found a real bug on first run: the privilege-guard trigger was blocking the
 * SERVICE ROLE from assigning perfis (auth.uid() is NULL for it, so app_is_admin()
 * was false), which silently broke the entire Admin module. See migration 0009.
 *
 * Cleans up after itself. Safe to re-run.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../../packages/core/', import.meta.url)))
const { createClient } = require('@supabase/supabase-js')

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SB_URL || !ANON || !SERVICE) {
  console.error('Missing env. Run with the vars from apps/web/.env.local:')
  console.error('  set -a && . ./apps/web/.env.local && set +a && node supabase/tests/rls-probe.mjs')
  process.exit(1)
}


const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } })

const EMAIL = 'rls-probe@oneos.com.br'
const SENHA = 'Probe-RLS-2026-xyz!'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`) }
}

// ── setup: a real auth user with NO perfil (so: no modules granted) ───────────
const existing = await admin.auth.admin.listUsers()
for (const u of existing.data.users) {
  if (u.email === EMAIL) await admin.auth.admin.deleteUser(u.id)
}

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: SENHA,
  email_confirm: true,
})
if (createErr) throw new Error('could not create probe user: ' + createErr.message)
const uid = created.user.id

await admin.from('usuarios').insert({
  id: uid,
  nome: 'Sonda RLS',
  email: EMAIL,
  perfil_id: null, // deliberately no profile => no modules
  ativo: true,
})

// A company to try to read.
await admin.from('empresas').insert({
  cnpj: '11222333000181',
  razao_social: 'ALVO DA SONDA LTDA',
  tipo: 'construtora',
})

// ── sign in as the probe user (anon key + session = the real client path) ─────
const user = createClient(SB_URL, ANON, { auth: { persistSession: false } })
const { error: signInErr } = await user.auth.signInWithPassword({ email: EMAIL, password: SENHA })
if (signInErr) throw new Error('probe could not sign in: ' + signInErr.message)

console.log('\n── With NO perfil (no modules granted) ──')

const r1 = await user.from('empresas').select('id, razao_social')
check('cannot read empresas without the module', r1.data?.length === 0,
  `-> got ${r1.data?.length ?? '?'} rows, err=${r1.error?.code ?? 'none'}`)

const r2 = await user.from('empresas').insert({ cnpj: '11444777000161', razao_social: 'X' })
check('cannot insert empresas without the module', !!r2.error, `-> err=${r2.error?.code ?? 'NONE — INSERT SUCCEEDED'}`)

const r3 = await user.from('audit_log').select('id')
check('cannot read audit_log (admin only)', r3.data?.length === 0 || !!r3.error)

// The columns that must be invisible even on your OWN row.
const r4 = await user.from('usuarios').select('expo_push_tokens').eq('id', uid)
check('cannot select expo_push_tokens (column not granted)', !!r4.error,
  `-> err=${r4.error?.code ?? 'NONE — COLUMN WAS READABLE'}`)

const r5 = await user.from('usuarios').select('web_push_subscriptions').eq('id', uid)
check('cannot select web_push_subscriptions (column not granted)', !!r5.error)

// ── privilege escalation attempts ────────────────────────────────────────────
console.log('\n── Privilege escalation ──')

const { data: perfilAdmin } = await admin.from('perfis').select('id').eq('nome', 'Admin').single()

const r6 = await user.from('usuarios').update({ perfil_id: perfilAdmin.id }).eq('id', uid)
check('cannot grant myself the Admin perfil', !!r6.error, `-> err=${r6.error?.code ?? 'NONE — ESCALATED!'}`)

const r7 = await user.from('usuarios').update({ ativo: false }).eq('id', uid)
check('cannot flip my own ativo flag', !!r7.error, `-> err=${r7.error?.code ?? 'NONE'}`)

const r8 = await user.rpc('app_is_admin')
check('app_is_admin() says false for me', r8.data === false, `-> ${JSON.stringify(r8.data)}`)

const r9 = await user.from('perfil_modulos').insert({ perfil_id: perfilAdmin.id, modulo_id: 'empresas' })
check('cannot write perfil_modulos (admin only)', !!r9.error, `-> err=${r9.error?.code ?? 'NONE — ESCALATED!'}`)

// ── now grant the empresas module and re-test ────────────────────────────────
console.log('\n── After granting a perfil with ONLY the empresas module ──')

const { data: perfilVendas } = await admin
  .from('perfis')
  .insert({ nome: 'Sonda Vendas', descricao: 'perfil temporário de teste' })
  .select()
  .single()
await admin.from('perfil_modulos').insert({ perfil_id: perfilVendas.id, modulo_id: 'empresas' })

// This is the call that silently failed before: the guard trigger called
// app_is_admin(), which is false for the service role (auth.uid() is NULL), so
// it blocked the one code path that is SUPPOSED to assign perfis.
const assign = await admin.from('usuarios').update({ perfil_id: perfilVendas.id }).eq('id', uid)
check('service role CAN assign a perfil (admin module depends on this)', !assign.error,
  `-> err=${assign.error?.message ?? 'none'}`)

const deact = await admin.from('usuarios').update({ ativo: false }).eq('id', uid)
check('service role CAN deactivate a user', !deact.error, `-> err=${deact.error?.message ?? 'none'}`)
await admin.from('usuarios').update({ ativo: true }).eq('id', uid) // undo

const r10 = await user.from('empresas').select('id, razao_social')
check('CAN now read empresas', (r10.data?.length ?? 0) > 0, `-> ${r10.data?.length ?? 0} rows`)

const r11 = await user.from('audit_log').select('id')
check('still cannot read audit_log (no admin module)', r11.data?.length === 0 || !!r11.error)

// The write helper: entity + event + audit in one transaction, as this user.
const r12 = await user.rpc('app_criar_empresa', {
  p: { cnpj: '11444777000161', razao_social: 'CRIADA PELA SONDA LTDA', tipo: 'construtora', estagio: 'lead' },
})
check('write helper app_criar_empresa works under RLS', !r12.error && !!r12.data?.id,
  `-> err=${r12.error?.message ?? 'none'}`)

if (r12.data?.id) {
  const { data: ev } = await admin.from('empresa_eventos').select('tipo, ator_usuario_id').eq('empresa_id', r12.data.id)
  check('...and emitted the empresa.criada event', ev?.some((e) => e.tipo === 'empresa.criada'))
  check('...with the acting user stamped on it', ev?.[0]?.ator_usuario_id === uid)

  const { data: al } = await admin.from('audit_log').select('acao, usuario_id').eq('entidade_id', r12.data.id)
  check('...and wrote the audit_log row', al?.some((a) => a.acao === 'empresa.criada'))
  check('...attributed to the acting user', al?.[0]?.usuario_id === uid)
}

// Deleting requires admin, which this perfil does not have.
const r13 = await user.from('empresas').delete().eq('cnpj', '11222333000181')
const { count: stillThere } = await admin
  .from('empresas').select('*', { count: 'exact', head: true }).eq('cnpj', '11222333000181')
check('cannot delete an empresa (admin only)', stillThere === 1, `-> row ${stillThere === 1 ? 'survived' : 'WAS DELETED'}`)

// ═══════════════════════════════════════════════════════════════════════════
// MERCADO (migrations 0011–0014)
//
// The probe user's perfil grants ONLY `empresas`. So every Mercado read must be
// refused — which is also the check that `mercado_explorador` is a
// security_invoker view and not the RLS-bypassing kind we shipped by mistake in
// 0002 and had to undo in 0005.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── Mercado, SEM o módulo concedido ──')

await admin.from('mercado_universo').delete().eq('cnpj', '33000167000101')
await admin.from('empresas').delete().eq('cnpj', '33000167000101')
await admin.from('mercado_universo').insert({
  cnpj: '33000167000101',
  cnpj_raiz: '33000167',
  razao_social: 'ALVO SO NO UNIVERSO LTDA',
  situacao_cadastral: 'ativa',
  cnae_principal: '4120400',
  uf: 'SP',
  camada: 'sam',
})

for (const tabela of [
  'mercado_universo',
  'mercado_socios',
  'grupos_economicos',
  'mercado_obras',
  'mercado_metricas',
  'mercado_ingestoes',
  'camada_regras',
  'segmentos',
]) {
  const { data, error } = await user.from(tabela).select('*').limit(1)
  check(`não lê ${tabela} sem o módulo`, (data?.length ?? 0) === 0 || !!error)
}

// The view UNIONs the universe with empresas-that-never-passed-through-staging.
// This user HAS the empresas module, so seeing their own empresas through the
// view is correct — that is not a leak, it is the same rows they can already
// read from `empresas`. What must NOT be visible is the UNIVERSE row.
const rv = await user.from('mercado_explorador').select('cnpj, camada').eq('cnpj', '33000167000101')
check(
  'a view mercado_explorador não vaza o universo (security_invoker)',
  (rv.data?.length ?? 0) === 0 || !!rv.error,
  `-> ${rv.data?.length ?? 0} linhas — A VIEW ESTÁ IGNORANDO O RLS!`,
)

const rp = await user.rpc('app_promover_empresa', { p: { cnpj: '33000167000101' } })
check('não promove empresa sem o módulo', !!rp.error, `-> err=${rp.error?.code ?? 'NENHUM — PROMOVEU!'}`)

// ── com o módulo mercado concedido ──────────────────────────────────────────
console.log('\n── Mercado, COM o módulo concedido ──')

await admin.from('perfil_modulos').insert({ perfil_id: perfilVendas.id, modulo_id: 'mercado' })

const rm1 = await user.from('mercado_explorador').select('cnpj, razao_social, camada').limit(5)
check('agora lê o universo pela view', (rm1.data?.length ?? 0) > 0, `-> ${rm1.data?.length ?? 0} linhas`)

const rm2 = await user.from('camada_regras').select('camada, versao, ativa').eq('ativa', true)
check('lê as regras da pirâmide', (rm2.data?.length ?? 0) === 3, `-> ${rm2.data?.length ?? 0}`)

// Rule authoring is a company-wide lever: admin only, even with the module.
const rm3 = await user.rpc('app_salvar_camada_regra', {
  p: {
    camada: 'tam',
    definicao: { operador: 'e', condicoes: [{ variavel: 'uf', operador: 'igual', valor: 'SP' }] },
    ativar: true,
  },
})
check('NÃO escreve regra de camada sem ser admin', !!rm3.error, `-> err=${rm3.error?.code ?? 'NENHUM — ESCREVEU!'}`)

// The staging tables are worker-owned: no insert policy for `authenticated`.
const rm4 = await user
  .from('mercado_universo')
  .insert({ cnpj: '11444777000161', cnpj_raiz: '11444777', razao_social: 'X' })
check('NÃO escreve no universo (só o worker escreve)', !!rm4.error, `-> err=${rm4.error?.code ?? 'NENHUM — ESCREVEU!'}`)

// Promotion IS allowed with the module, and it is idempotent.
const rm5 = await user.rpc('app_promover_empresa', { p: { cnpj: '33000167000101' } })
check('promove empresa com o módulo', !rm5.error && !!rm5.data?.id, `-> err=${rm5.error?.message ?? 'nenhum'}`)
check('a promovida herda a camada do universo', rm5.data?.camada === 'sam', `-> ${rm5.data?.camada}`)
check("a promovida marca origem='mercado'", rm5.data?.origem === 'mercado', `-> ${rm5.data?.origem}`)

const rm6 = await user.rpc('app_promover_empresa', { p: { cnpj: '33000167000101' } })
check('promover de novo é idempotente (mesma empresa, sem erro)', !rm6.error && rm6.data?.id === rm5.data?.id)

if (rm5.data?.id) {
  const { data: ev } = await admin
    .from('empresa_eventos').select('tipo').eq('empresa_id', rm5.data.id)
  check('...emitiu o evento empresa.promovida', ev?.some((e) => e.tipo === 'empresa.promovida'))
  const { data: evs } = await admin
    .from('empresa_eventos').select('tipo').eq('empresa_id', rm5.data.id)
  check('...e NÃO duplicou o evento na 2ª promoção', evs?.filter((e) => e.tipo === 'empresa.promovida').length === 1,
    `-> ${evs?.filter((e) => e.tipo === 'empresa.promovida').length} eventos`)
}

// Segments: anyone in the module may create one, stamped as theirs.
const rm7 = await user.rpc('app_criar_segmento', {
  p: {
    nome: 'Sonda — SP com obras',
    definicao: {
      operador: 'e',
      condicoes: [
        { variavel: 'uf', operador: 'igual', valor: 'SP' },
        { variavel: 'obras_ativas', operador: 'maior_ou_igual', valor: 1 },
      ],
    },
  },
})
check('cria segmento com o módulo', !rm7.error && !!rm7.data?.id, `-> err=${rm7.error?.message ?? 'nenhum'}`)
check('o segmento é carimbado com o autor', rm7.data?.criado_por === uid)

// ── app_config (0016): leitura para todos, escrita só admin ─────────────────
// The promotion threshold decides how many of ~2M universe rows get promoted
// into `empresas`. Lowering it to TAM would promote hundreds of thousands. It is
// a company-wide lever, and the FIRST implementation of this setting stored it in
// audit_log — whose insert policy lets any active user append a row. This asserts
// the real table refuses what that one would have accepted.
console.log('\n── app_config ──')

const rc1 = await user.from('app_config').select('chave, valor').eq('chave', 'mercado.promocao_camada')
check('qualquer usuário ativo LÊ a config', rc1.data?.length === 1, `-> ${rc1.data?.length ?? 0}`)
check('o padrão semeado é "sam"', rc1.data?.[0]?.valor === 'sam', `-> ${JSON.stringify(rc1.data?.[0]?.valor)}`)

const rc2 = await user
  .from('app_config')
  .update({ valor: '"tam"' })
  .eq('chave', 'mercado.promocao_camada')
const { data: aposUpdate } = await admin
  .from('app_config').select('valor').eq('chave', 'mercado.promocao_camada').single()
check(
  'NÃO altera a config direto na tabela sem ser admin',
  aposUpdate?.valor === 'sam',
  `-> virou ${JSON.stringify(aposUpdate?.valor)} — ALTEROU!`,
)

const rc3 = await user.rpc('app_definir_config', {
  p: { chave: 'mercado.promocao_camada', valor: 'tam' },
})
const { data: aposRpc } = await admin
  .from('app_config').select('valor').eq('chave', 'mercado.promocao_camada').single()
check(
  'NÃO altera a config pela RPC sem ser admin',
  aposRpc?.valor === 'sam',
  `-> virou ${JSON.stringify(aposRpc?.valor)} — ALTEROU! err=${rc3.error?.code ?? 'nenhum'}`,
)

const rc4 = await user.from('app_config').insert({ chave: 'invadido', valor: '"x"' })
check('NÃO cria chave de config nova sem ser admin', !!rc4.error, `-> err=${rc4.error?.code ?? 'NENHUM — CRIOU!'}`)


// ═══════════════════════════════════════════════════════════════════════════
// ANTECIPAÇÃO (migrations 0045–0052)
//
// O funil de NFs. Três invariantes que uma policy solta destruiria:
//   1. `notas_funil` é security_invoker — sem o módulo, o funil não existe.
//   2. `notas_fiscais` e `mensagens_outbox` NÃO têm grant de update/insert: o
//      único caminho de escrita é o RPC, que grava evento + audit na transação.
//      É isso que torna "mover um card sem registrar o evento" inexprimível.
//   3. O ponteiro do token de WhatsApp não é legível (0052 conserta o revoke por
//      coluna que 0046 fez em cima de um grant de tabela e que não pegou).
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── Antecipação, SEM o módulo concedido ──')

const CHAVE_PROBE = 'PROBE000000000000000000000000000000000000RLS'
await admin.from('notas_fiscais').delete().eq('access_key', CHAVE_PROBE)
await admin.from('notas_fiscais').insert({
  access_key: CHAVE_PROBE,
  tipo: 'NFe',
  direction: 'received',
  valor: 123456.78,
  vencimento: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10),
  vencimento_origem: 'xml',
  dias_para_vencimento: 40,
  sacado_cnpj: '11222333000181',
  sacado_nome: 'SACADO DO PROBE',
  sacado_cadastrado: true,
  fornecedor_cnpj: '11444777000161',
  fornecedor_nome: 'FORNECEDOR DO PROBE',
  fornecedor_cadastrado: true,
  credit_status: 'APPROVED',
  credit_disponivel: 999999,
  faixa: 'alta',
  faixa_motivo: 'regra',
})

for (const tabela of [
  'notas_fiscais',
  'nota_itens',
  'credito_snapshots',
  'faixa_regras',
  'faixa_disparos',
  'mensagens_outbox',
  'cnpj_lookup_fila',
  'antecipacao_config',
]) {
  const { data, error } = await user.from(tabela).select('*').limit(1)
  check(`não lê ${tabela} sem o módulo`, (data?.length ?? 0) === 0 || !!error)
}

const ra0 = await user.from('notas_funil').select('access_key').eq('access_key', CHAVE_PROBE)
check(
  'a view notas_funil não vaza o funil (security_invoker)',
  (ra0.data?.length ?? 0) === 0 || !!ra0.error,
  `-> ${ra0.data?.length ?? 0} linhas — A VIEW ESTÁ IGNORANDO O RLS!`,
)

const ra1 = await user.rpc('app_mover_estagio_nf', {
  p: { access_key: CHAVE_PROBE, estagio_funil: 'em_prospeccao' },
})
check('não move estágio sem o módulo', !!ra1.error, `-> err=${ra1.error?.code ?? 'NENHUM — MOVEU!'}`)

const ra2 = await user.rpc('app_marcar_sem_interesse', {
  p: { fornecedor_cnpj: '11444777000161', motivo: 'probe' },
})
check('não suprime fornecedor sem o módulo', !!ra2.error, `-> err=${ra2.error?.code ?? 'NENHUM — SUPRIMIU!'}`)

// ── com o módulo antecipacao concedido ──────────────────────────────────────
console.log('\n── Antecipação, COM o módulo concedido ──')

await admin.from('perfil_modulos').insert({ perfil_id: perfilVendas.id, modulo_id: 'antecipacao' })

const rb1 = await user.from('notas_funil').select('access_key, faixa, dias_para_vencimento, fornecedor_tipagem').eq('access_key', CHAVE_PROBE)
check('agora lê o funil pela view', (rb1.data?.length ?? 0) === 1, `-> ${rb1.data?.length ?? 0} linhas`)
check('a view calcula dias_para_vencimento', rb1.data?.[0]?.dias_para_vencimento === 40, `-> ${rb1.data?.[0]?.dias_para_vencimento}`)
check('a view calcula a tipagem do fornecedor', rb1.data?.[0]?.fornecedor_tipagem === 'ativacao', `-> ${rb1.data?.[0]?.fornecedor_tipagem}`)

const rb2 = await user.from('faixa_regras').select('faixa, versao, ativa').eq('ativa', true)
check('lê as regras de faixa ativas', (rb2.data?.length ?? 0) === 3, `-> ${rb2.data?.length ?? 0}`)

// A nota só muda de estágio pelo RPC: a tabela não tem grant de update.
const rb3 = await user.from('notas_fiscais').update({ estagio_funil: 'convertida' }).eq('access_key', CHAVE_PROBE)
const { data: aposDireto } = await admin
  .from('notas_fiscais').select('estagio_funil').eq('access_key', CHAVE_PROBE).single()
check(
  'NÃO escreve em notas_fiscais direto na tabela (só pelo RPC)',
  aposDireto?.estagio_funil === 'a_prospectar',
  `-> virou ${aposDireto?.estagio_funil} — ESCREVEU! err=${rb3.error?.code ?? 'nenhum'}`,
)

const rb4 = await user.rpc('app_mover_estagio_nf', {
  p: { access_key: CHAVE_PROBE, estagio_funil: 'em_prospeccao' },
})
check('move estágio pelo RPC com o módulo', !rb4.error && rb4.data?.estagio_funil === 'em_prospeccao',
  `-> ${rb4.data?.estagio_funil ?? `err=${rb4.error?.message}`}`)

if (!rb4.error) {
  const { data: ev } = await admin.from('empresa_eventos').select('tipo, ator_usuario_id')
    .eq('tipo', 'nf.estagio_alterado').order('criado_em', { ascending: false }).limit(1)
  check('...e emitiu nf.estagio_alterado', ev?.length === 1)
  const { data: al } = await admin.from('audit_log').select('acao, usuario_id')
    .eq('acao', 'antecipacao.estagio_movido').order('criado_em', { ascending: false }).limit(1)
  check('...e gravou o audit_log atribuído ao ator', al?.[0]?.usuario_id === uid)
}

// "Perdida" sem motivo tem de ser recusada: o motivo é o insumo da métrica.
const rb5 = await user.rpc('app_mover_estagio_nf', {
  p: { access_key: CHAVE_PROBE, estagio_funil: 'perdida' },
})
check('NÃO marca perdida sem motivo', !!rb5.error, `-> err=${rb5.error?.code ?? 'NENHUM — ACEITOU!'}`)

// A régua e as contas são alavanca da empresa: admin, mesmo com o módulo.
const rb6 = await user.from('faixa_regras').insert({ faixa: 'alta', versao: 999, definicao: {}, ativa: false })
check('NÃO cria regra de faixa sem ser admin', !!rb6.error, `-> err=${rb6.error?.code ?? 'NENHUM — CRIOU!'}`)

const rb7 = await user.rpc('app_salvar_whatsapp_conta', {
  p: { apelido: 'probe', numero: '5511999990000', token: 'segredo-do-probe' },
})
check('NÃO cadastra conta de WhatsApp sem ser admin', !!rb7.error, `-> err=${rb7.error?.code ?? 'NENHUM — CADASTROU!'}`)

// O ponteiro do segredo não pode voltar por PostgREST (0052).
const rb8 = await user.from('whatsapp_contas').select('token_secret_id').limit(1)
check('NÃO lê token_secret_id (sem grant de coluna)', !!rb8.error,
  `-> err=${rb8.error?.code ?? 'NENHUM — LEU O PONTEIRO DO SEGREDO!'}`)

const rb9 = await user.from('whatsapp_contas').select('id, apelido, token_definido_em').limit(1)
check('...mas lê apelido e token_definido_em', !rb9.error, `-> err=${rb9.error?.code ?? 'nenhum'}`)

// A outbox é gerada pelo worker; o usuário só lê e descarta pelo RPC.
const rb10 = await user.from('mensagens_outbox').insert({
  canal: 'email', fornecedor_cnpj: '11444777000161', access_keys: [CHAVE_PROBE],
})
check('NÃO insere na outbox (só o worker gera)', !!rb10.error, `-> err=${rb10.error?.code ?? 'NENHUM — INSERIU!'}`)

// Supressão soft: expira, e a nota sai da faixa na hora.
const rb11 = await user.rpc('app_marcar_sem_interesse', {
  p: { fornecedor_cnpj: '11444777000161', motivo: 'probe: sem interesse agora', eterna: false, dias: 90 },
})
check('suprime fornecedor com o módulo', !rb11.error && !!rb11.data?.id, `-> err=${rb11.error?.message ?? 'nenhum'}`)
check('a supressão soft ganha data de expiração', !!rb11.data?.expira_em, `-> ${rb11.data?.expira_em}`)
check("a supressão carrega contexto 'antecipacao'", rb11.data?.contexto === 'antecipacao', `-> ${rb11.data?.contexto}`)

const { data: aposSupressao } = await admin
  .from('notas_fiscais').select('faixa, faixa_motivo').eq('access_key', CHAVE_PROBE).single()
check('suprimir tira a nota da faixa na hora', aposSupressao?.faixa === null && aposSupressao?.faixa_motivo === 'suprimido',
  `-> faixa=${aposSupressao?.faixa} motivo=${aposSupressao?.faixa_motivo}`)

// ── teardown ─────────────────────────────────────────────────────────────────
if (rm7.data?.id) await admin.from('segmentos').delete().eq('id', rm7.data.id)
await admin.from('notas_fiscais').delete().eq('access_key', CHAVE_PROBE)
await admin.from('supressao').delete().eq('valor', '11444777000161')
await admin.from('mercado_universo').delete().in('cnpj', ['11222333000181', '11444777000161', '33000167000101'])
await admin.from('empresas').delete().in('cnpj', ['11222333000181', '11444777000161', '33000167000101'])
await admin.from('usuarios').delete().eq('id', uid)
await admin.auth.admin.deleteUser(uid)
await admin.from('perfis').delete().eq('id', perfilVendas.id)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
