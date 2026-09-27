import { diasEntreDatas } from '../../../../../packages/core/src/cobranca/datas.js'
import { formatarBrl, formatarCnpjCobranca, formatarDataBr } from '../../../../../packages/core/src/cobranca/modelos.js'
import type { AlertaApolice } from '../../../../../packages/core/src/cobranca/relogio-apolice.js'

/**
 * As decisões dos jobs da Cobrança que não precisam de banco — separadas para serem
 * testadas sem `db.ts` (que exige o env inteiro no boot). Quem lê e escreve são
 * relogio.ts, lembretes.ts, documentos.ts e dossie.ts.
 */

// ─── Insolvência pela classe do processo (§6.1) ─────────────────────────────

/**
 * A classe processual do Jurídico diz se há falência ou recuperação JUDICIAL.
 * Recuperação EXTRAjudicial fica de fora: não é a insolvência da cl. 00300.00, e contá-la
 * encurtaria o prazo do sinistro de um sacado que não quebrou.
 */
export function tipoInsolvenciaDaClasse(classe: string | null | undefined): 'falencia' | 'recuperacao_judicial' | null {
  if (!classe) return null
  const c = classe.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/falencia/.test(c)) return 'falencia'
  if (/recuperacao\s+judicial/.test(c) && !/extrajudicial/.test(c)) return 'recuperacao_judicial'
  return null
}

// ─── Agregação dos alertas do relógio (§6.3 item 3) ─────────────────────────

export interface AlertaDeTitulo {
  prazo_id: string
  titulo_id: string
  numero: string | null
  sacado_matriz_cnpj: string
  sacado_nome: string | null
  empresa_id: string | null
  valor_face: number
  cobranca_id: string | null
  cobranca_codigo: string | null
  responsavel_id: string | null
  alerta: AlertaApolice
}

export interface GrupoDeAlerta {
  sacado_matriz_cnpj: string
  sacado_nome: string | null
  empresa_id: string | null
  /** A chave do alerta do core (`parada_cobertura`, `envio_sinistro:60`…). */
  chave: string
  marco: AlertaApolice['marco']
  nivel: AlertaApolice['nivel']
  data_marco: string
  dias_restantes: number
  mensagem: string
  itens: AlertaDeTitulo[]
  valor: number
  cobranca_ids: string[]
  cobranca_codigos: string[]
  responsaveis: string[]
}

const PESO_NIVEL = { aviso: 0, alto: 1, critico: 2 } as const

/**
 * UM aviso por (grupo do sacado, marco), e não um por título.
 *
 * A produção não informa a liquidação pelo sacado (§2): há centenas de títulos
 * "abertos" vencidos, e muitos são de um mesmo grupo. Um aviso por título mandaria
 * dezenas de pushes idênticos para o mesmo gestor na mesma manhã — o jeito mais rápido
 * de ensinar alguém a ignorar o sino justamente no dia do D+85. O grupo é também a
 * unidade da apólice: a franquia é por Comprador (§7.3).
 *
 * O marco mais próximo do grupo dá a data e a frase; o nível é o mais grave.
 */
export function agruparAlertas(entradas: readonly AlertaDeTitulo[]): GrupoDeAlerta[] {
  const grupos = new Map<string, GrupoDeAlerta>()
  for (const e of entradas) {
    const k = `${e.sacado_matriz_cnpj}|${e.alerta.chave}`
    let g = grupos.get(k)
    if (!g) {
      g = {
        sacado_matriz_cnpj: e.sacado_matriz_cnpj,
        sacado_nome: e.sacado_nome,
        empresa_id: e.empresa_id,
        chave: e.alerta.chave,
        marco: e.alerta.marco,
        nivel: e.alerta.nivel,
        data_marco: e.alerta.data_marco,
        dias_restantes: e.alerta.dias_restantes,
        mensagem: e.alerta.mensagem,
        itens: [],
        valor: 0,
        cobranca_ids: [],
        cobranca_codigos: [],
        responsaveis: [],
      }
      grupos.set(k, g)
    }
    g.itens.push(e)
    g.valor = Math.round((g.valor + e.valor_face) * 100) / 100
    g.sacado_nome ??= e.sacado_nome
    g.empresa_id ??= e.empresa_id
    if (PESO_NIVEL[e.alerta.nivel] > PESO_NIVEL[g.nivel]) g.nivel = e.alerta.nivel
    if (e.alerta.dias_restantes < g.dias_restantes) {
      g.dias_restantes = e.alerta.dias_restantes
      g.data_marco = e.alerta.data_marco
      g.mensagem = e.alerta.mensagem
    }
    if (e.cobranca_id && !g.cobranca_ids.includes(e.cobranca_id)) {
      g.cobranca_ids.push(e.cobranca_id)
      if (e.cobranca_codigo) g.cobranca_codigos.push(e.cobranca_codigo)
    }
    if (e.responsavel_id && !g.responsaveis.includes(e.responsavel_id)) g.responsaveis.push(e.responsavel_id)
  }
  return [...grupos.values()].sort(
    (a, b) => PESO_NIVEL[b.nivel] - PESO_NIVEL[a.nivel] || a.dias_restantes - b.dias_restantes,
  )
}

/**
 * A chave de repetição do motor (0262). O crítico carrega o DIA: ele repete todo dia
 * até resolver (§14), e a trava de 20h da regra só impede o segundo aviso na mesma
 * manhã. Os outros avisam uma vez por marco — quem garante isso é `alertas_emitidos`.
 */
export function chaveDoAviso(g: Pick<GrupoDeAlerta, 'chave' | 'nivel' | 'sacado_matriz_cnpj'>, hoje: string): string {
  return `apolice:${g.chave}:${g.sacado_matriz_cnpj}${g.nivel === 'critico' ? `:${hoje}` : ''}`
}

/** O texto do aviso agregado. */
export function textoDoAviso(g: GrupoDeAlerta): { titulo: string; resumo: string } {
  const quem = g.sacado_nome ?? formatarCnpjCobranca(g.sacado_matriz_cnpj)
  const qtd = g.itens.length
  const onde = g.cobranca_codigos.length ? ` Cobrança ${g.cobranca_codigos.join(', ')}.` : ' Sem cobrança aberta.'
  return {
    titulo: `${g.nivel === 'critico' ? 'CRÍTICO — ' : ''}Relógio da apólice: ${quem}`,
    resumo:
      `${g.mensagem} ${qtd} título(s), ${formatarBrl(g.valor)}; marco em ${formatarDataBr(g.data_marco)}.` + onde,
  }
}

// ─── Reiteração devida (§5) ─────────────────────────────────────────────────

/**
 * O lembrete sai quando a última rodada ENVIADA passou do prazo de reiteração e
 * ninguém começou a próxima. Uma rodada nova em rascunho é alguém já cuidando disso —
 * lembrá-lo do que ele está fazendo é ruído.
 */
export function reiteracaoDevida(e: {
  ultima_rodada_enviada: number | null
  enviada_em: string | null
  maior_rodada: number
  hoje: string
  dias_para_reiteracao: number
}): boolean {
  if (e.ultima_rodada_enviada === null || !e.enviada_em) return false
  if (e.maior_rodada > e.ultima_rodada_enviada) return false
  return diasEntreDatas(e.enviada_em.slice(0, 10), e.hoje) >= e.dias_para_reiteracao
}

// ─── Minuta de confissão (§9.3) ─────────────────────────────────────────────

const cpf = (c: string) => {
  const d = c.replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c
}

export interface AvalistaMinuta {
  nome: string
  cpf: string
  estado_civil: string
  endereco: string
  conjuge?: string | null
}

/** Um parágrafo de qualificação por avalista. Nenhum avalista = `null` (o modelo acusa). */
export function formatarAvalistas(avs: readonly AvalistaMinuta[] | null | undefined): string | null {
  if (!avs?.length) return null
  return avs
    .map(
      (a, k) =>
        `${avs.length > 1 ? `${k + 1}. ` : ''}**${a.nome}**, inscrito(a) no CPF sob o nº ${cpf(a.cpf)}, ${a.estado_civil}, ` +
        `residente e domiciliado(a) em ${a.endereco}${a.conjuge ? `, com anuência do(a) cônjuge ${a.conjuge}` : ''}.`,
    )
    .join('\n\n')
}

/** Testemunhas com a linha de assinatura. Sem testemunhas, as linhas em branco. */
export function formatarTestemunhas(ts: readonly { nome: string; cpf: string }[] | null | undefined): string {
  const lista = ts?.length ? ts : [null, null]
  return lista
    .map((t, k) =>
      t
        ? `${k + 1}. _____________________________\nNome: ${t.nome} · CPF ${cpf(t.cpf)}`
        : `${k + 1}. _____________________________\nNome: ________________ · CPF ______________`,
    )
    .join('\n\n')
}

// ─── Memória de cálculo por título ──────────────────────────────────────────

export interface LinhaMemoriaMinima {
  operacao_id: string
  subtotal: number
  dias_em_atraso?: number
}

/**
 * O subtotal atualizado de cada título, lido da memória GRAVADA na notificação. A
 * linha pode ter sido montada com o id de `cobranca_titulos` ou com o de `titulos` —
 * as duas chaves são aceitas, e nada é recalculado aqui: a carta mostra o número que a
 * tela mostrou quando alguém decidiu enviá-la.
 */
export function valoresDaMemoria(
  memoria: { memoria?: readonly LinhaMemoriaMinima[] } | null | undefined,
): Map<string, LinhaMemoriaMinima> {
  const m = new Map<string, LinhaMemoriaMinima>()
  for (const l of memoria?.memoria ?? []) {
    if (l && typeof l.operacao_id === 'string' && Number.isFinite(Number(l.subtotal))) m.set(l.operacao_id, l)
  }
  return m
}

/** Carimbo para nome de arquivo: `20260926T091500Z`. Nunca sobrescreve um PDF anterior. */
export function carimbo(agora: Date = new Date()): string {
  return agora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
