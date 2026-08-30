import {
  MOTIVO_EXCLUSAO_LABELS,
  duracaoEstimada,
  escolherVariante,
  termosProibidos,
  type MotivoExclusao,
  type Variante,
} from '../../../../../packages/core/src/campanhas/index.js'
import {
  exigeDescadastro,
  primeiroNome,
  renderizarMensagem,
} from '../../../../../packages/core/src/comunicacao/index.js'
import { formatCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'
import { avaliarPublico, type CampanhaParaAvaliar } from '../../campanhas/avaliar.js'
import { lerLimitesCampanhas } from '../../campanhas/config.js'
import { lerConfigComunicacao } from '../../comunicacao/config.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * O DRY-RUN OBRIGATÓRIO (§3).
 *
 * Ele não é um relatório: é o passo que destrava a aprovação. Uma campanha só
 * sai de rascunho depois de rodar aqui, e qualquer edição posterior zera a
 * simulação — porque aprovar sobre um retrato antigo é aprovar outra campanha.
 *
 * O que ele mostra, e por que cada coisa:
 *
 *   total → elegíveis → excluídos POR MOTIVO
 *     A cascata é a informação. "1.200 empresas, 340 elegíveis" sem os motivos
 *     manda a pessoa mexer no filtro quando o problema era enriquecimento.
 *
 *   duração estimada
 *     Uma campanha de 16 dias úteis é uma decisão diferente de uma de 2 dias, e
 *     a diferença só aparece depois que alguém multiplica — então multiplicamos.
 *
 *   prévia renderizada de CADA variante, com destinatários REAIS
 *     Nome de exemplo esconde o template que quebra quando o contato não tem
 *     nome. A prévia usa quem vai receber de verdade.
 *
 *   aviso de descadastro
 *     Quem não tem `formulario_aceite` recebe o link no rodapé. É melhor saber
 *     disso antes de escrever o texto do que depois de o rodapé aparecer.
 */

export interface ResultadoSimulacao {
  campanha_id: string
  total_empresas: number
  elegiveis: number
  exclusoes: Record<string, number>
  duracao: string
  previas: PreviaVariante[]
  avisos: string[]
  descricao_publico: string
}

interface PreviaVariante {
  variante_id: string
  template_nome: string | null
  assunto: string | null
  corpo: string
  destinatario: string
  /** Termos que a validação de conteúdo estranhou (§7). É aviso, não bloqueio. */
  termos_estranhos: { tipo: string; trecho: string }[]
}

interface LinhaCampanha extends CampanhaParaAvaliar {
  nome: string
  variantes: Variante[]
  ritmo_por_dia: number
  vendedor_id: string | null
}

export async function simularCampanha(campanhaId: string): Promise<ResultadoSimulacao> {
  const { data, error } = await supabaseAdmin
    .from('campanhas')
    .select(
      'id, nome, tipo, canal, origem_publico, segmento_id, definicao_filtro, preset, preset_params, empresas_manuais, variantes, ritmo_por_dia, excluir_contatados_dias, excluir_conversa_aberta, vendedor_id',
    )
    .eq('id', campanhaId)
    .maybeSingle()

  if (error || !data) throw new Error(error?.message ?? 'Campanha não encontrada.')
  const c = data as unknown as LinhaCampanha

  const [limites, cfgComunicacao] = await Promise.all([
    lerLimitesCampanhas(true),
    lerConfigComunicacao(true),
  ])

  const avaliado = await avaliarPublico(
    { ...c, id: campanhaId, preset_params: (c.preset_params ?? {}) as Record<string, unknown> },
    limites,
  )

  const duracao = duracaoEstimada({
    total: avaliado.elegiveis.length,
    ritmoPorDia: c.ritmo_por_dia,
    diasDaSemana: cfgComunicacao.janela.dias_semana,
  })

  const previas = await montarPrevias(c, avaliado.elegiveis.slice(0, 50))

  const avisos: string[] = []
  const semAceite = avaliado.elegiveis.filter((e) =>
    exigeDescadastro(c.canal, e.destinatario.baseLegal),
  ).length
  if (semAceite > 0) {
    avisos.push(
      `${semAceite} destinatário(s) sem aceite explícito: o e-mail sairá com link de descadastro no rodapé.`,
    )
  }
  for (const p of previas) {
    for (const t of p.termos_estranhos) {
      avisos.push(`Variante ${p.variante_id}: "${t.trecho}" parece ${t.tipo}. Confira antes de aprovar.`)
    }
  }
  if (avaliado.elegiveis.length === 0) {
    avisos.push('Nenhum destinatário elegível — a campanha não pode ser aprovada assim.')
  }

  const resultado: ResultadoSimulacao = {
    campanha_id: campanhaId,
    total_empresas: avaliado.totalEmpresas,
    elegiveis: avaliado.elegiveis.length,
    exclusoes: rotular(avaliado.exclusoes),
    duracao: duracao.texto,
    previas,
    avisos,
    descricao_publico: avaliado.descricao,
  }

  const { error: erroRegistro } = await supabaseAdmin.rpc('app_campanha_registrar_simulacao', {
    p: { campanha_id: campanhaId, simulacao: resultado } as never,
  })
  if (erroRegistro) throw new Error(erroRegistro.message)

  logger.info(
    { campanha: c.nome, total: resultado.total_empresas, elegiveis: resultado.elegiveis },
    'Simulação de campanha concluída.',
  )
  return resultado
}

/** Rótulos em pt-BR e sem os zerados: o painel mostra o que aconteceu. */
function rotular(exclusoes: Record<MotivoExclusao, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [motivo, n] of Object.entries(exclusoes)) {
    if (n > 0) out[MOTIVO_EXCLUSAO_LABELS[motivo as MotivoExclusao] ?? motivo] = n
  }
  return out
}

async function montarPrevias(
  c: LinhaCampanha,
  amostra: Awaited<ReturnType<typeof avaliarPublico>>['elegiveis'],
): Promise<PreviaVariante[]> {
  const variantes = (c.variantes ?? []) as Variante[]
  if (variantes.length === 0 || amostra.length === 0) return []

  const templateIds = [...new Set(variantes.map((v) => v.template_id))]
  const { data: templates } = await supabaseAdmin
    .from('templates_mensagem')
    .select('id, nome, assunto, corpo')
    .in('id', templateIds)
  const porId = new Map((templates ?? []).map((t) => [t.id, t]))

  const empresaIds = [...new Set(amostra.map((e) => e.empresaId))]
  const { data: empresas } = await supabaseAdmin
    .from('empresas')
    .select('id, razao_social, nome_fantasia, cnpj')
    .in('id', empresaIds)
  const empresaPorId = new Map((empresas ?? []).map((e) => [e.id, e]))

  const remetente = await nomeDoRemetente(c.vendedor_id)

  const previas: PreviaVariante[] = []
  for (const v of variantes) {
    const t = porId.get(v.template_id)
    if (!t) continue

    // O destinatário da prévia é escolhido pela MESMA função que escolherá no
    // envio: assim a prévia mostra um texto que alguém realmente vai receber.
    const alvo =
      amostra.find((e) => escolherVariante(variantes, v.passo, e.destinatario.contato.id)?.id === v.id) ??
      amostra[0]!

    const empresa = empresaPorId.get(alvo.empresaId)
    const corpo = renderizarMensagem(
      t.corpo,
      {
        contato_nome: primeiroNome(alvo.destinatario.contato.nome),
        contato_cargo: alvo.destinatario.contato.cargo ?? '',
        empresa_nome: empresa?.razao_social ?? empresa?.nome_fantasia ?? '',
        empresa_cnpj: empresa?.cnpj ? formatCnpj(empresa.cnpj) : '',
        remetente_nome: remetente,
      },
      {
        canal: c.canal,
        baseLegal: alvo.destinatario.baseLegal,
        linkDescadastro: '{link de descadastro}',
      },
    )

    previas.push({
      variante_id: v.id,
      template_nome: t.nome,
      assunto: t.assunto,
      corpo,
      destinatario: `${alvo.destinatario.contato.nome ?? 'sem nome'} · ${empresa?.razao_social ?? ''}`,
      termos_estranhos: termosProibidos(`${t.assunto ?? ''} ${t.corpo}`).map((a) => ({
        tipo: a.tipo,
        trecho: a.trecho,
      })),
    })
  }
  return previas
}

async function nomeDoRemetente(vendedorId: string | null): Promise<string> {
  if (!vendedorId) return 'ONE OS'
  const { data } = await supabaseAdmin
    .from('vendedores')
    .select('nome')
    .eq('id', vendedorId)
    .maybeSingle()
  return data?.nome ?? 'ONE OS'
}
