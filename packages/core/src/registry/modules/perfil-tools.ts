import {
  AVISO_VIES,
  TRILHAS,
  TRILHA_LABELS,
  comparacao as acharComparacao,
  fraseAchado,
  fraseConversaoForaDeFaixa,
  perfilResumoSchema,
  perfilSugestoesSchema,
  variavelPerfil,
  type AchadoContraste,
  type Auditoria,
  type PerfilResumoInput,
  type PerfilSugestoesInput,
  type Sugestao,
  type Trilha,
} from '../../perfil/index.js'
import type { Json } from '../../types/database.js'
import type { ModuleTool, ToolContext } from '../types.js'

/**
 * As tools do Perfil de Quem Opera (04f §8).
 *
 * Vivem no módulo MERCADO — o perfil existe para ajustar as réguas de camada e
 * de faixa, e quem cuida delas já tem esse módulo. Um módulo próprio criaria uma
 * permissão a mais para uma tela só.
 *
 * As duas de leitura carregam SEMPRE o aviso de viés no retorno. Não é
 * redundância com a tela: a resposta do assistente costuma ser copiada para
 * outro lugar (um slide, uma mensagem), e é ali — longe do rodapé do painel —
 * que a ressalva mais faz falta.
 */

interface SnapshotBruto {
  id: string
  trilha: Trilha
  comparacao: string
  resultados: {
    achados?: AchadoContraste[]
    resumo?: string
    rotulo_a?: string
    rotulo_b?: string
  } | null
  auditoria: Auditoria | null
  sugestoes: Sugestao[] | null
  coorte_a: number
  coorte_b: number
  calculado_em: string
}

async function lerSnapshots(ctx: ToolContext, trilha: Trilha) {
  const { data, error } = await ctx.supabase.rpc('perfil_snapshot_atual', {
    p: { trilha } as unknown as Json,
  })
  if (error) throw new Error(`Falha ao ler o perfil: ${error.message}`)
  const r = data as {
    tem_acesso?: boolean
    snapshots?: SnapshotBruto[]
    decisoes?: { sugestao_id: string; acao: string }[]
  } | null
  return r
}

// ─── perfil.resumo ──────────────────────────────────────────────────────────

async function resumo(input: PerfilResumoInput, ctx: ToolContext) {
  const trilhas: readonly Trilha[] = input.trilha ? [input.trilha] : TRILHAS
  const saida: unknown[] = []

  for (const trilha of trilhas) {
    const r = await lerSnapshots(ctx, trilha)
    if (!r?.tem_acesso) {
      return { tem_acesso: false, mensagem: 'Você não tem acesso ao módulo Mercado.' }
    }

    for (const s of r.snapshots ?? []) {
      const meta = acharComparacao(s.comparacao)
      const achados = s.resultados?.achados ?? []
      const rotuloA = s.resultados?.rotulo_a ?? 'o grupo que opera'
      const rotuloB = s.resultados?.rotulo_b ?? 'o grupo de comparação'

      // Só os achados que a tela mostraria no painel principal. Despejar os 30 e
      // deixar o assistente escolher é como um achado suprimido por cobertura de
      // 12% vira a frase de abertura de uma apresentação.
      const principais = achados
        .filter((a) => !a.suprimido && a.confianca === 'solida')
        .slice(0, 5)
        .map((a) => ({
          variavel: a.variavel,
          label: variavelPerfil(a.variavel)?.label ?? a.variavel,
          frase: fraseAchado(a, variavelPerfil(a.variavel), rotuloA, rotuloB),
          lift: a.destaque?.lift ?? null,
          n_a: a.destaque?.n_a ?? 0,
          n_b: a.destaque?.n_b ?? 0,
        }))

      saida.push({
        trilha,
        trilha_label: TRILHA_LABELS[trilha],
        comparacao: meta?.label ?? s.comparacao,
        resumo: s.resultados?.resumo ?? null,
        coorte_a: { rotulo: rotuloA, total: s.coorte_a },
        coorte_b: { rotulo: rotuloB, total: s.coorte_b },
        // Quantos achados a régua de honestidade calou. É a diferença entre
        // "não há padrão" e "ainda não há dado", e as duas exigem ações opostas.
        achados_principais: principais,
        achados_sem_amostra: achados.filter((a) => a.confianca === 'indicativo').length,
        achados_suprimidos: achados.filter((a) => a.suprimido).length,
        auditoria: resumirAuditoria(s.auditoria),
        sugestoes_pendentes: (s.sugestoes ?? []).length,
        calculado_em: s.calculado_em,
      })
    }
  }

  if (saida.length === 0) {
    return {
      tem_acesso: true,
      mensagem:
        'O perfil ainda não foi calculado. Ele roda uma vez por mês, depois das calibrações de ' +
        'faturamento e de crédito, e pode ser disparado manualmente pela tela.',
      route: '/mercado/perfil',
    }
  }

  return { tem_acesso: true, trilhas: saida, aviso: AVISO_VIES, route: '/mercado/perfil' }
}

function resumirAuditoria(a: Auditoria | null) {
  if (!a) return null
  return {
    camadas: a.camadas.map((c) => ({
      camada: c.camada,
      versao: c.versao,
      coorte: c.coorte,
      total: c.total,
      nao_passam: c.nao_passam,
      fracao_fora: c.total > 0 ? c.nao_passam / c.total : 0,
      principais_barreiras: c.barreiras.slice(0, 3).map((b) => ({
        condicao: b.descricao,
        barra: b.barrados,
      })),
    })),
    faixas: a.faixas
      ? {
          frase: fraseConversaoForaDeFaixa(
            a.faixas.convertidas_sem_faixa,
            a.faixas.convertidas_total,
          ),
          por_faixa: a.faixas.por_faixa,
        }
      : null,
  }
}

// ─── perfil.sugestoes_pendentes ─────────────────────────────────────────────

async function sugestoesPendentes(input: PerfilSugestoesInput, ctx: ToolContext) {
  const trilhas: readonly Trilha[] = input.trilha ? [input.trilha] : TRILHAS
  const saida: unknown[] = []

  for (const trilha of trilhas) {
    const r = await lerSnapshots(ctx, trilha)
    if (!r?.tem_acesso) {
      return { tem_acesso: false, mensagem: 'Você não tem acesso ao módulo Mercado.' }
    }
    const decididas = new Set((r.decisoes ?? []).map((d) => d.sugestao_id))

    for (const s of r.snapshots ?? []) {
      for (const sug of (s.sugestoes ?? []).filter((x) => !decididas.has(x.id))) {
        saida.push({
          id: sug.id,
          trilha,
          tipo: sug.tipo,
          alvo: sug.alvo,
          frase: sug.frase,
          detalhe: sug.detalhe,
          de: sug.de,
          para: sug.para,
          snapshot_id: s.id,
        })
      }
    }
  }

  return {
    tem_acesso: true,
    pendentes: saida.length,
    sugestoes: saida,
    // A tool NÃO aceita nem descarta. Aceitar abre um editor de regra com o
    // rascunho carregado, e essa é uma tela — não um efeito colateral de uma
    // conversa. Uma regra de camada reclassifica ~2M linhas.
    observacao:
      'Para aplicar uma sugestão, abra /mercado/perfil e use "Criar nova versão com este ajuste": ' +
      'o editor da regra abre com a alteração no rascunho, e a ativação continua sendo humana.',
    aviso: AVISO_VIES,
    route: '/mercado/perfil',
  }
}

export const perfilTools: readonly ModuleTool[] = [
  {
    id: 'perfil.resumo',
    name: 'Perfil de quem opera',
    description:
      'O retrato das empresas que realmente operam — construtoras que mais antecipam e ' +
      'fornecedores cujas notas convertem — comparado a um grupo de controle, com lift e tamanho ' +
      'de amostra. Traz também a auditoria: quanto da coorte que opera a régua vigente deixaria ' +
      'de fora, e por qual condição. Use para "como são nossos melhores clientes?" e "nossa régua ' +
      'está mirando certo?".',
    inputSchema: perfilResumoSchema,
    mutates: false,
    execute: (input, ctx) => resumo(input as PerfilResumoInput, ctx),
  },
  {
    id: 'perfil.sugestoes_pendentes',
    name: 'Sugestões de ajuste de régua',
    description:
      'As sugestões de ajuste de regra de camada ou de faixa que o último cálculo do perfil gerou ' +
      'e que ainda não foram aceitas nem descartadas, com a evidência de cada uma. Somente ' +
      'leitura: aplicar exige abrir o editor da regra.',
    inputSchema: perfilSugestoesSchema,
    mutates: false,
    execute: (input, ctx) => sugestoesPendentes(input as PerfilSugestoesInput, ctx),
  },
]
