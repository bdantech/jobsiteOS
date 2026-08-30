import { z } from 'zod'
import {
  ACAO_LABELS,
  CANAL_COMUNICACAO_LABELS,
  INTENCAO_TRIAGEM_LABELS,
  MODO_AGENTE_LABELS,
  enfileirarMensagem,
  type AcaoAgente,
  type CanalComunicacao,
  type IntencaoTriagem,
  type ModoAgente,
} from '../../comunicacao/index.js'
import { formatCnpj, normalizeCnpj } from '../../schemas/cnpj.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Módulo Comunicação (05A): o cano, o ledger e o agente.
 *
 * ─── A ÚNICA MUTAÇÃO AQUI ENFILEIRA, E NUNCA ENVIA ──────────────────────────
 * `comunicacao.enviar_mensagem` chama o MESMO RPC do compositor, que aplica o
 * portão dentro da transação. Não existe caminho por onde o modelo mande uma
 * mensagem que a tela não mandaria: se o contato está suprimido, se não tem base
 * legal ou se falamos com ele ontem, a tool recebe o mesmo "não" que a pessoa
 * receberia — e devolve o motivo, que é o que faz a IA explicar em vez de tentar
 * de novo.
 *
 * Numa conversa em modo `sugestao`, o envio vira sugestão: quem aperta enviar
 * continua sendo gente.
 */

const cnpjSchema = z
  .string()
  .transform(normalizeCnpj)
  .refine((v) => /^\d{14}$/.test(v), 'CNPJ precisa ter 14 dígitos.')

const canalLabel = (c: string | null): string =>
  c ? (CANAL_COMUNICACAO_LABELS[c as CanalComunicacao] ?? c) : '—'

// ─── historico_empresa ──────────────────────────────────────────────────────

const historicoSchema = z.object({
  cnpj: cnpjSchema,
  limite: z.number().int().min(1).max(50).default(20),
})

async function historicoEmpresa(input: z.infer<typeof historicoSchema>, ctx: ToolContext) {
  const { data: empresa, error: erroEmpresa } = await ctx.supabase
    .from('empresas')
    .select('id, razao_social, nome_fantasia')
    .eq('cnpj', input.cnpj)
    .maybeSingle()
  if (erroEmpresa) throw new Error(erroEmpresa.message)
  if (!empresa) return { total: 0, aviso: `Nenhuma empresa cadastrada com o CNPJ ${formatCnpj(input.cnpj)}.` }

  const { data, error } = await ctx.supabase
    .from('comunicacoes_thread')
    .select('canal, direcao, por_ia, assunto, preview, corpo, status_envio, origem, funil, contato_nome, vendedor_nome, usuario_nome, triagem, criado_em')
    .eq('empresa_id', empresa.id)
    .order('criado_em', { ascending: false })
    .limit(input.limite)
  if (error) throw new Error(error.message)

  const linhas = data ?? []
  if (linhas.length === 0) {
    return {
      total: 0,
      empresa: empresa.razao_social ?? empresa.nome_fantasia,
      aviso: 'Nenhuma comunicação registrada com esta empresa ainda.',
    }
  }

  return {
    total: linhas.length,
    empresa: empresa.razao_social ?? empresa.nome_fantasia,
    mensagens: linhas.map((l) => ({
      quando: l.criado_em,
      canal: canalLabel(l.canal),
      direcao: l.direcao === 'entrada' ? 'recebida' : 'enviada',
      // Quem falou importa: uma resposta a uma mensagem da persona de IA é uma
      // conversa diferente de uma resposta ao originador.
      quem: l.direcao === 'entrada' ? (l.contato_nome ?? 'contato') : (l.por_ia ? `${l.vendedor_nome ?? 'IA'} (IA)` : (l.vendedor_nome ?? l.usuario_nome ?? 'equipe')),
      assunto: l.assunto,
      // O corpo inteiro só quando é curto; senão o preview. Uma thread de seis
      // meses não cabe no contexto e não precisa caber.
      texto: (l.corpo?.length ?? 0) <= 400 ? (l.corpo ?? l.preview) : l.preview,
      status: l.status_envio,
      intencao: intencaoDe(l.triagem),
    })),
  }
}

function intencaoDe(triagem: unknown): string | null {
  const t = triagem as { intencao?: string } | null
  if (!t?.intencao) return null
  return INTENCAO_TRIAGEM_LABELS[t.intencao as IntencaoTriagem] ?? t.intencao
}

// ─── enviar_mensagem ────────────────────────────────────────────────────────

const enviarSchema = z.object({
  contato_id: z.string().uuid().describe('Id do contato. Use empresas.detalhe para descobri-lo.'),
  canal: z.enum(['whatsapp', 'email']),
  assunto: z.string().max(300).optional().describe('Só para e-mail.'),
  corpo: z.string().min(1).describe('A mensagem pronta, em português do Brasil.'),
})

async function enviarMensagem(input: z.infer<typeof enviarSchema>, ctx: ToolContext) {
  try {
    const msg = (await enfileirarMensagem(ctx.supabase, input)) as { id?: string } | null
    return {
      ok: true,
      outbox_id: msg?.id ?? null,
      aviso:
        'A mensagem foi ENFILEIRADA, não enviada. Ela sai quando a janela de envio abrir e ' +
        'depois de passar pelo portão (supressão, cooldown, teto do número). Acompanhe em ' +
        '/comunicacao.',
    }
  } catch (e) {
    // O motivo da recusa é a informação útil: sem ele a IA tenta de novo.
    return { ok: false, erro: e instanceof Error ? e.message : 'Não foi possível enfileirar a mensagem.' }
  }
}

// ─── proximo_passo ──────────────────────────────────────────────────────────

const proximoPassoSchema = z.object({
  cnpj: cnpjSchema.optional().describe('Omitido, traz as sugestões pendentes de todas as conversas visíveis.'),
  limite: z.number().int().min(1).max(25).default(10),
})

async function proximoPasso(input: z.infer<typeof proximoPassoSchema>, ctx: ToolContext) {
  let q = ctx.supabase
    .from('inbox_conversas')
    .select('id, canal, empresa_cnpj, empresa_nome, contato_nome, objetivo, modo_agente, status, ultima_mensagem_em, proxima_acao_em, sugestao_id, sugestao_acao, sugestao_conteudo, sugestao_justificativa, sugestao_confianca')
    .not('sugestao_id', 'is', null)
    .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
    .limit(input.limite)

  if (input.cnpj) q = q.eq('empresa_cnpj', input.cnpj)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const linhas = data ?? []
  if (linhas.length === 0) {
    return {
      total: 0,
      aviso: input.cnpj
        ? 'Nenhum próximo passo sugerido para esta empresa.'
        : 'Nenhum próximo passo sugerido no momento.',
    }
  }

  return {
    total: linhas.length,
    sugestoes: linhas.map((l) => ({
      conversa_id: l.id,
      empresa: l.empresa_nome,
      cnpj: l.empresa_cnpj ? formatCnpj(l.empresa_cnpj) : null,
      contato: l.contato_nome,
      canal: canalLabel(l.canal),
      modo: MODO_AGENTE_LABELS[(l.modo_agente ?? '') as ModoAgente] ?? l.modo_agente,
      acao: ACAO_LABELS[(l.sugestao_acao ?? '') as AcaoAgente] ?? l.sugestao_acao,
      mensagem_sugerida: l.sugestao_conteudo,
      porque: l.sugestao_justificativa,
      confianca: l.sugestao_confianca,
    })),
    aviso:
      'Aceitar ou descartar uma sugestão é feito na tela (/comunicacao ou no card do funil), ' +
      'onde o texto aparece inteiro antes de sair.',
  }
}

// ─── inbox_pendentes ────────────────────────────────────────────────────────

const inboxSchema = z.object({
  apenas_nao_vinculadas: z
    .boolean()
    .default(false)
    .describe('true traz só a fila de identificação — quem falou e não sabemos quem é.'),
  limite: z.number().int().min(1).max(30).default(15),
})

async function inboxPendentes(input: z.infer<typeof inboxSchema>, ctx: ToolContext) {
  const { data: naoVinculadas, error: erroNv } = await ctx.supabase
    .from('conversas_nao_vinculadas')
    .select('id, canal, identificador_externo, nome_sugerido, qtd_mensagens, ultima_mensagem_em')
    .eq('status', 'pendente')
    .order('ultima_mensagem_em', { ascending: false })
    .limit(input.limite)
  if (erroNv) throw new Error(erroNv.message)

  const fila = (naoVinculadas ?? []).map((n) => ({
    id: n.id,
    canal: canalLabel(n.canal),
    de: n.nome_sugerido ?? n.identificador_externo,
    mensagens: n.qtd_mensagens,
    ultima_em: n.ultima_mensagem_em,
  }))

  if (input.apenas_nao_vinculadas) {
    return {
      nao_vinculadas: fila.length,
      fila,
      aviso: fila.length
        ? 'Cada uma dessas é uma pessoa que falou com a gente e ninguém identificou. Vincular é uma tela em /comunicacao/nao-vinculadas.'
        : 'Nenhuma conversa aguardando identificação.',
    }
  }

  const { data: naoLidas, error } = await ctx.supabase
    .from('inbox_conversas')
    .select('id, canal, empresa_nome, contato_nome, nao_lidas, ultima_preview, ultima_mensagem_em, responsavel_nome')
    .gt('nao_lidas', 0)
    .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
    .limit(input.limite)
  if (error) throw new Error(error.message)

  return {
    nao_lidas: (naoLidas ?? []).length,
    nao_vinculadas: fila.length,
    conversas: (naoLidas ?? []).map((c) => ({
      conversa_id: c.id,
      canal: canalLabel(c.canal),
      empresa: c.empresa_nome,
      contato: c.contato_nome,
      responsavel: c.responsavel_nome,
      nao_lidas: c.nao_lidas,
      ultima: c.ultima_preview,
      quando: c.ultima_mensagem_em,
    })),
    fila_de_identificacao: fila,
  }
}

export const comunicacaoModule: AppModule = {
  id: 'comunicacao',
  name: 'Comunicação',
  // `message-circle` já estava pré-registrado no mapa de ícones da web desde a
  // fundação, reservado para este módulo.
  icon: 'message-circle',
  route: '/comunicacao',
  // `operacoes`: é onde a conversa acontece. Mercado acha a empresa, Radar acha o
  // contato — aqui é onde alguém fala com ele.
  group: 'operacoes',
  tools: [
    {
      id: 'comunicacao.historico_empresa',
      name: 'Histórico de conversas da empresa',
      description:
        'Toda a comunicação com uma empresa — WhatsApp, e-mail, ligações e reuniões, de entrada ' +
        'e de saída, de humanos e da IA — em ordem cronológica inversa. É o ledger canônico: ' +
        'nenhum outro lugar do sistema sabe o que foi falado.',
      inputSchema: historicoSchema,
      mutates: false,
      execute: (input, ctx) => historicoEmpresa(input as z.infer<typeof historicoSchema>, ctx),
    },
    {
      id: 'comunicacao.enviar_mensagem',
      name: 'Enviar mensagem',
      description:
        'ENFILEIRA uma mensagem de WhatsApp ou e-mail para um contato. Não envia na hora: a ' +
        'mensagem passa pelo portão (supressão, base legal, cooldown, janela de envio, teto do ' +
        'número) e sai quando puder. Se o portão recusar, você recebe o motivo — explique-o em ' +
        'vez de tentar de novo. Exige confirmação explícita da pessoa antes de chamar.',
      inputSchema: enviarSchema,
      mutates: true,
      execute: (input, ctx) => enviarMensagem(input as z.infer<typeof enviarSchema>, ctx),
    },
    {
      id: 'comunicacao.proximo_passo',
      name: 'Próximos passos sugeridos',
      description:
        'O que o agente decidiu que é o próximo passo de cada conversa, com a mensagem pronta e ' +
        'a justificativa. Sugestões pendentes apenas — o que já foi aceito ou descartado não ' +
        'aparece.',
      inputSchema: proximoPassoSchema,
      mutates: false,
      execute: (input, ctx) => proximoPasso(input as z.infer<typeof proximoPassoSchema>, ctx),
    },
    {
      id: 'comunicacao.inbox_pendentes',
      name: 'Inbox: o que está esperando',
      description:
        'Conversas com mensagens não lidas e a fila de identificação — quem falou com a gente e ' +
        'o sistema não soube quem era. Use para responder "tem alguma coisa esperando por mim?".',
      inputSchema: inboxSchema,
      mutates: false,
      execute: (input, ctx) => inboxPendentes(input as z.infer<typeof inboxSchema>, ctx),
    },
  ],
}
