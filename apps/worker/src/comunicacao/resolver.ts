import {
  dominioDoEmail,
  dominioIdentificaEmpresa,
  identificadorCanonico,
  type CanalThread,
} from '../../../../packages/core/src/comunicacao/index.js'
import { EVENTO_TIPOS } from '../../../../packages/core/src/constants.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import { emitirEvento } from '../radar/eventos.js'

/**
 * RESOLUÇÃO AUTOMÁTICA (§4), na ordem em que a certeza cai:
 *
 *   1. `contatos`            — o identificador já é de alguém cadastrado. Certeza.
 *   2. `contatos_descobertos`— a cascata (04l) achou este telefone/e-mail para um
 *                              CNPJ. Não é contato oficial ainda, mas sabemos de
 *                              quem é.
 *   3. domínio de e-mail     — é alguém NOVO de uma empresa que já está na base.
 *   4. CNPJ citado no corpo  — a pessoa se identificou escrevendo o CNPJ.
 *
 * O que NÃO resolve vira fila de identificação — e essa é a decisão importante:
 * adivinhar aqui é pior que perguntar. Vincular a mensagem à empresa errada põe a
 * conversa de um estranho na timeline de um cliente, e ninguém encontra o erro
 * depois.
 */

export interface Resolucao {
  empresaId: string | null
  contatoId: string | null
  vendedorId: string | null
  /** Como chegamos aqui. Vai para o log e ajuda a calibrar a cascata. */
  via: 'contato' | 'contato_descoberto' | 'dominio' | 'cnpj_no_corpo' | null
}

const VAZIO: Resolucao = { empresaId: null, contatoId: null, vendedorId: null, via: null }

export async function resolverRemetente(args: {
  canal: CanalThread
  identificador: string
  corpo?: string | null
}): Promise<Resolucao> {
  const ident = identificadorCanonico(args.canal, args.identificador)
  if (!ident) return VAZIO

  const porContato = await porContatoCadastrado(args.canal, ident)
  if (porContato) return porContato

  const porDescoberto = await porContatoDescoberto(args.canal, ident)
  if (porDescoberto) return porDescoberto

  if (args.canal === 'email') {
    const porDominio = await porDominioConhecido(ident)
    if (porDominio) return porDominio
  }

  const porCnpj = await porCnpjNoCorpo(args.corpo)
  if (porCnpj) return porCnpj

  return VAZIO
}

async function porContatoCadastrado(canal: CanalThread, ident: string): Promise<Resolucao | null> {
  const coluna = canal === 'email' ? 'email' : 'whatsapp'
  const { data } = await supabaseAdmin
    .from('contatos')
    .select('id, empresa_id, email, telefone, whatsapp')
    .or(canal === 'email' ? `email.eq.${ident}` : `whatsapp.eq.${ident},telefone.eq.${ident}`)
    .limit(5)

  // O `.or()` compara o texto CRU do banco; um telefone gravado com máscara não
  // casa. Por isso a checagem final é feita aqui, sobre a forma canônica — é a
  // mesma normalização do resto do módulo.
  const achado = (data ?? []).find((c) => {
    const valores = canal === 'email' ? [c.email] : [c.whatsapp, c.telefone]
    return valores.some((v) => identificadorCanonico(canal, v) === ident)
  })
  if (!achado) {
    void coluna
    return null
  }

  return {
    empresaId: achado.empresa_id,
    contatoId: achado.id,
    vendedorId: await donoDaEmpresa(achado.empresa_id),
    via: 'contato',
  }
}

/**
 * A cascata do 04l guarda o valor já em forma canônica (`contatos_descobertos.valor`),
 * então aqui a comparação é direta — e é por isso que a descoberta continua
 * valendo a pena mesmo depois de o canal existir: ela é quem sabe de quem é um
 * número que nunca nos escreveu antes.
 */
async function porContatoDescoberto(canal: CanalThread, ident: string): Promise<Resolucao | null> {
  const tipos = canal === 'email' ? ['email'] : ['whatsapp', 'telefone']
  const { data } = await supabaseAdmin
    .from('contatos_descobertos')
    .select('fornecedor_cnpj, promovido_contato_id')
    .in('tipo', tipos)
    .eq('valor', ident)
    .limit(1)
    .maybeSingle()
  if (!data) return null

  const { data: empresa } = await supabaseAdmin
    .from('empresas')
    .select('id')
    .eq('cnpj', data.fornecedor_cnpj)
    .maybeSingle()
  if (!empresa) return null

  return {
    empresaId: empresa.id,
    contatoId: data.promovido_contato_id,
    vendedorId: await donoDaEmpresa(empresa.id),
    via: 'contato_descoberto',
  }
}

/**
 * Domínio conhecido resolve a EMPRESA, nunca a pessoa: `contatoId` fica nulo de
 * propósito, e a conversa continua indo para a fila de identificação com a
 * empresa já sugerida. É a diferença entre "sabemos de onde ele fala" e "sabemos
 * quem ele é" — e criar um contato sozinho aqui encheria a base de nomes
 * inventados a partir de endereços de e-mail.
 */
async function porDominioConhecido(ident: string): Promise<Resolucao | null> {
  const dominio = dominioDoEmail(ident)
  if (!dominioIdentificaEmpresa(dominio)) return null

  const { data } = await supabaseAdmin
    .from('contatos')
    .select('empresa_id')
    .ilike('email', `%@${dominio}`)
    .limit(1)
    .maybeSingle()
  if (!data?.empresa_id) return null

  return {
    empresaId: data.empresa_id,
    contatoId: null,
    vendedorId: await donoDaEmpresa(data.empresa_id),
    via: 'dominio',
  }
}

async function porCnpjNoCorpo(corpo: string | null | undefined): Promise<Resolucao | null> {
  if (!corpo) return null
  // Só dígitos com pontuação de CNPJ. Um número de 14 dígitos solto no meio de um
  // texto é chute; o formato com pontuação é alguém se identificando.
  const m = corpo.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)
  if (!m) return null
  const cnpj = m[0].replace(/\D/g, '')

  const { data } = await supabaseAdmin.from('empresas').select('id').eq('cnpj', cnpj).maybeSingle()
  if (!data) return null

  return {
    empresaId: data.id,
    contatoId: null,
    vendedorId: await donoDaEmpresa(data.id),
    via: 'cnpj_no_corpo',
  }
}

/** O dono vigente da conta, na ordem em que ele é o interlocutor natural. */
export async function donoDaEmpresa(empresaId: string | null): Promise<string | null> {
  if (!empresaId) return null
  const { data } = await supabaseAdmin
    .from('vendedor_carteira')
    .select('vendedor_id, papel')
    .eq('empresa_id', empresaId)
    .is('ate', null)
  if (!data?.length) return null

  const peso: Record<string, number> = { originacao: 1, sdr: 2, gestao_passiva: 3 }
  return [...data].sort((a, b) => (peso[a.papel] ?? 9) - (peso[b.papel] ?? 9))[0]?.vendedor_id ?? null
}

/**
 * A FILA DE IDENTIFICAÇÃO. Uma linha por (canal, identificador), com contador —
 * três mensagens do mesmo desconhecido são um item da fila, não três.
 *
 * O evento só é emitido na PRIMEIRA mensagem: o sino tocando a cada follow-up de
 * quem ainda não foi identificado ensina a ignorar o sino.
 */
export async function enfileirarNaoVinculada(args: {
  canal: CanalThread
  identificador: string
  nomeSugerido: string | null
  contaRecebedora: string | null
  vendedorSugeridoId?: string | null
  em: Date
}): Promise<void> {
  const ident = identificadorCanonico(args.canal, args.identificador)
  if (!ident) return

  const { data: existente } = await supabaseAdmin
    .from('conversas_nao_vinculadas')
    .select('id, qtd_mensagens, status')
    .eq('canal', args.canal)
    .eq('identificador_externo', ident)
    .maybeSingle()

  if (existente) {
    // Uma conversa IGNORADA que volta a falar precisa voltar para a fila: quem
    // marcou spam pode ter errado, e a segunda mensagem é a evidência.
    await supabaseAdmin
      .from('conversas_nao_vinculadas')
      .update({
        qtd_mensagens: (existente.qtd_mensagens ?? 0) + 1,
        ultima_mensagem_em: args.em.toISOString(),
        nome_sugerido: args.nomeSugerido ?? undefined,
        ...(existente.status === 'ignorada' ? { status: 'pendente' } : {}),
      })
      .eq('id', existente.id)
    return
  }

  const { error } = await supabaseAdmin.from('conversas_nao_vinculadas').insert({
    canal: args.canal,
    identificador_externo: ident,
    nome_sugerido: args.nomeSugerido,
    conta_recebedora: args.contaRecebedora,
    vendedor_sugerido_id: args.vendedorSugeridoId ?? null,
    primeira_mensagem_em: args.em.toISOString(),
    ultima_mensagem_em: args.em.toISOString(),
    qtd_mensagens: 1,
  })
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao enfileirar conversa não vinculada.')
    return
  }

  await emitirEvento(null, EVENTO_TIPOS.CONVERSA_NAO_VINCULADA, {
    titulo: 'Conversa aguardando identificação',
    resumo: `${args.nomeSugerido ?? ident} falou por ${args.canal} e ainda não sabemos quem é.`,
    url: '/comunicacao/nao-vinculadas',
    canal: args.canal,
    identificador: ident,
  })
}
