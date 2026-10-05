import { z } from 'zod'
import {
  formatarNota,
  lerAgregado,
  lerAnalise,
  lerFeedback,
  lerReuniaoCaptura,
} from '../../analise/leituras.js'
import { ESCOPO_ANALISE_LABELS, TIPO_PENDENCIA_LABELS } from '../../analise/tipos.js'
import type { ModuleTool } from '../types.js'

/**
 * As tools da Inteligência de Conversas (05C §14) — todas de LEITURA. A barra não
 * contesta, não rotula e não muda rubrica: contestar é a voz do vendedor sobre o próprio
 * trabalho, e rotular é o gesto que calibra a régua de todo mundo. Os dois têm dono.
 *
 * Quem vê o quê é do banco: as RPCs devolvem nada para a análise de outro vendedor, e a
 * barra recebe exatamente o que a tela receberia.
 */

const minhasSchema = z.object({
  dias: z.number().int().min(1).max(365).optional().describe('Janela em dias. Padrão 30.'),
  vendedor_id: z.string().uuid().optional().describe('Só gestores: o vendedor (ou agente de IA) a consultar.'),
})

const detalheSchema = z.object({ analise_id: z.string().uuid() })

const reuniaoSchema = z.object({
  evento_id: z.string().uuid().describe('O id da reunião (vendedor_eventos), como aparece no card.'),
  incluir_transcricao: z.boolean().optional().describe('Traz o texto da transcrição (cortado em ~12 mil caracteres).'),
})

const agregadoSchema = z.object({ dias: z.number().int().min(7).max(365).optional() })

const cortar = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}… [cortado]` : (s ?? null))

export const qualidadeTools: ModuleTool[] = [
  {
    id: 'qualidade.minhas_analises',
    name: 'Minhas análises de conversa',
    description:
      'Feedback das interações analisadas (reuniões, ligações e conversas): nota de cada uma, o que faltou com a citação ' +
      'e a orientação, os itens em que mais perde pontos e as pendências abertas. Por padrão, as do próprio usuário; ' +
      'gestores podem passar vendedor_id. A nota é aritmética sobre itens aplicáveis — nula é "sem avaliação aplicável", não zero.',
    inputSchema: minhasSchema,
    execute: async (input, ctx) => {
      const i = input as z.infer<typeof minhasSchema>
      const f = await lerFeedback(ctx.supabase, { vendedor_id: i.vendedor_id ?? null, dias: i.dias ?? 30, limite: 10 })
      if (!f) return { erro: 'Sem acesso a estas análises, ou o usuário não é vendedor.' }
      return {
        vendedor: f.vendedor.nome,
        nota_media: formatarNota(f.resumo.nota_media),
        analises: f.resumo.analises,
        em_sombra: f.em_sombra,
        ultimas: f.ultimas.map((u) => ({
          analise_id: u.id,
          tipo: ESCOPO_ANALISE_LABELS[u.escopo],
          empresa: u.empresa_nome,
          nota: formatarNota(u.score),
          explicacao: u.explicacao,
          quando: u.analisada_em,
          faltas: u.faltas.map((x) => ({ item: x.rotulo, citacao: x.citacao, orientacao: x.orientacao })),
        })),
        onde_mais_perde: f.piores_itens.map((p) => ({ item: p.rotulo, taxa_atendimento: p.taxa, orientacao: p.orientacao })),
        pendencias: f.pendencias.length,
        route: '/comercial/feedback',
      }
    },
    mutates: false,
  },
  {
    id: 'qualidade.detalhe_analise',
    name: 'Detalhe de uma análise',
    description:
      'Uma análise item a item: a pergunta da rubrica, se se aplicava, se foi atendida, a citação e a orientação, e ' +
      'a memória de cálculo da nota. Use depois de qualidade.minhas_analises para explicar uma nota.',
    inputSchema: detalheSchema,
    execute: async (input, ctx) => {
      const a = await lerAnalise(ctx.supabase, (input as z.infer<typeof detalheSchema>).analise_id)
      if (!a) return { erro: 'Análise não encontrada ou sem acesso.' }
      return {
        tipo: ESCOPO_ANALISE_LABELS[a.analise.escopo],
        empresa: a.empresa?.nome ?? null,
        vendedor: a.vendedor?.nome ?? null,
        modo: a.analise.modo,
        nota: formatarNota(a.analise.score),
        explicacao: a.analise.explicacao,
        rubrica_versao: a.analise.rubrica_versao,
        itens: a.itens.map((x) => ({
          etapa: x.etapa,
          item: x.rotulo,
          pergunta: x.pergunta,
          aplicavel: x.aplicavel,
          atendido: x.atendido,
          peso: x.peso,
          citacao: x.citacao,
          orientacao: x.orientacao ?? (x.atendido === false ? x.orientacao_rubrica : null),
          contestado: x.contestado,
        })),
        route: `/comercial/feedback?analise=${a.analise.id}`,
      }
    },
    mutates: false,
  },
  {
    id: 'qualidade.pendencias',
    name: 'Pendências das conversas',
    description:
      'O que ficou parado do nosso lado nas conversas analisadas: pergunta sem resposta, retorno fora do prazo, ' +
      'compromisso combinado. Por padrão, as do próprio usuário.',
    inputSchema: minhasSchema,
    execute: async (input, ctx) => {
      const i = input as z.infer<typeof minhasSchema>
      const f = await lerFeedback(ctx.supabase, { vendedor_id: i.vendedor_id ?? null, dias: i.dias ?? 30, limite: 1 })
      if (!f) return { erro: 'Sem acesso.' }
      return {
        pendencias: f.pendencias.map((p) => ({
          tipo: TIPO_PENDENCIA_LABELS[p.tipo],
          empresa: p.empresa_nome,
          descricao: p.descricao,
          prazo: p.prazo_em,
          conversa_id: p.conversa_id,
        })),
        route: '/comercial/meu-dia',
      }
    },
    mutates: false,
  },
  {
    id: 'qualidade.reuniao',
    name: 'Transcrição e análise de uma reunião',
    description:
      'A captura de uma reunião: se o gravador entrou, o resumo, os próximos passos, os participantes, a análise e ' +
      '(opcional) a transcrição. Visível a quem vê a reunião.',
    inputSchema: reuniaoSchema,
    execute: async (input, ctx) => {
      const i = input as z.infer<typeof reuniaoSchema>
      const r = await lerReuniaoCaptura(ctx.supabase, i.evento_id)
      if (!r) return { erro: 'Reunião não encontrada ou sem acesso.' }
      return {
        captura: r.reuniao?.captura_status ?? (r.captura_ligada ? 'sem captura' : 'captura desligada'),
        resumo: r.reuniao?.resumo ?? null,
        proximos_passos: r.reuniao?.proximos_passos ?? [],
        participantes: r.reuniao?.participantes ?? [],
        duracao_min: r.reuniao?.duracao_s ? Math.round(r.reuniao.duracao_s / 60) : null,
        link_fireflies: r.reuniao?.url_fireflies ?? null,
        analise: r.analise ? { analise_id: r.analise.id, nota: formatarNota(r.analise.score), explicacao: r.analise.explicacao } : null,
        transcricao: i.incluir_transcricao ? cortar(r.reuniao?.transcricao, 12_000) : undefined,
      }
    },
    mutates: false,
  },
  {
    id: 'qualidade.agregado',
    name: 'Qualidade do time (gestor)',
    description:
      'Visão de gestor: nota média por vendedor e agente de IA, por etapa da rubrica, objeções, menções a concorrente, ' +
      'taxa de contestação por item (item muito contestado é pergunta mal escrita) e custo por provedor. Só gestores.',
    inputSchema: agregadoSchema,
    execute: async (input, ctx) => {
      try {
        const a = await lerAgregado(ctx.supabase, (input as z.infer<typeof agregadoSchema>).dias ?? 90)
        return {
          por_vendedor: a.por_vendedor.map((v) => ({
            vendedor: v.nome,
            ia: v.is_ia,
            nota_media: formatarNota(v.nota_media),
            analises: v.analises,
            em_sombra: v.em_sombra,
            pendencias_abertas: v.pendencias_abertas,
          })),
          por_etapa: a.por_etapa,
          objecoes: a.objecoes,
          concorrentes: a.concorrentes.length,
          contestacao_por_item: a.contestacao_por_item.slice(0, 10),
          custo: a.custo.slice(0, 3),
          route: '/comercial/qualidade',
        }
      } catch {
        return { erro: 'Só a gestão comercial vê o agregado.' }
      }
    },
    mutates: false,
  },
]
