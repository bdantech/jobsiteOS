import { emAtraso, hojeSaoPaulo } from '../../../../../packages/core/src/cobranca/datas.js'
import {
  alertasDoDia,
  calcularPrazosApolice,
  escolherApolice,
  prazosPerdidos,
  restabelecimentoCobertura,
  type ApoliceRelogio,
  type EstadoPrazo,
} from '../../../../../packages/core/src/cobranca/relogio-apolice.js'
import { formatarBrl, formatarCnpjCobranca, formatarDataBr } from '../../../../../packages/core/src/cobranca/modelos.js'
import {
  buscarReconciliacaoCobranca,
  type ReconciliacaoGrupo,
} from '../../../../../packages/core/src/cobranca/reconciliacao.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { todasAsPaginas } from '../../paginar.js'
import { avisar } from '../../radar/eventos.js'
import { dataSp, lerConfigCobranca, lotes, registrarEvento } from './comum.js'
import {
  agruparAlertas,
  chaveDoAviso,
  textoDoAviso,
  tipoInsolvenciaDaClasse,
  type AlertaDeTitulo,
} from './regras.js'

/**
 * `cobranca/relogio-apolice` (Prompt 07 §6.3), diário às 06:00 de São Paulo.
 *
 * A parte que não pode falhar. Em ordem:
 *   a) insolvência — a registrada à mão e a DETECTADA no Jurídico (falência/RJ do sacado);
 *   b) um `apolice_prazos` por título aberto, coberto e vencido, com as quatro datas;
 *   c) fecha o prazo do título que deixou de estar aberto e grava se a cobertura volta
 *      com efeito retroativo — é dinheiro (§6.3 item 2);
 *   d) os alertas escalonados, UM por grupo e marco (ver `agruparAlertas`);
 *   e) o prazo que passou sem o ato vira `perdido`, com um aviso só.
 *
 * ── GRUPO EM DIA PELA PLATAFORMA NÃO ALERTA (0270) ──────────────────────────
 * A produção não marca a liquidação por título: o pago continua `BILLET_SWAPPED`, e sem
 * este filtro o relógio avisaria "5 dias para perder a indenização" de sacado que já
 * pagou. Quando o limite consumido do grupo não cobre mais os vencidos, os prazos
 * continuam calculados (o relógio não apaga nada), mas não geram aviso nem viram
 * `perdido` — a não ser que o título esteja numa cobrança ativa, onde uma pessoa já
 * decidiu que a dívida existe. Se a leitura da plataforma falhar, avisa tudo: um
 * alerta falso custa menos que um prazo de apólice perdido em silêncio.
 *
 * ── NADA VAI À SEGURADORA ───────────────────────────────────────────────────
 * §6.3.4: "o alerta é a ação". Este job não chama API nem manda e-mail a ninguém de fora;
 * notificar a Atradius é um botão, apertado por gente, na tela do sinistro.
 *
 * ── IDEMPOTENTE ─────────────────────────────────────────────────────────────
 * Rodar duas vezes no mesmo dia não duplica nada: o upsert é por (título, apólice), o
 * aviso de cada marco é lembrado em `alertas_emitidos`, e o motor de avisos tem a trava
 * de 20h pela `chave`. Um dia sem job também não engole aviso — `alertasDoDia` avisa o
 * marco na primeira execução em que a antecedência foi alcançada.
 */

export interface ResultadoRelogio {
  hoje: string
  insolvencias_detectadas: number
  prazos_calculados: number
  titulos_sem_apolice: number
  prazos_encerrados: number
  avisos: number
  titulos_avisados: number
  prazos_perdidos: number
  avisos_perdido: number
  /** Prazos calados porque a plataforma registra o grupo em dia (0270). */
  prazos_em_dia_pela_plataforma: number
}

const SITUACOES_ATIVAS = ['em_cobranca', 'acordado', 'protestado', 'sinistrado']
/** Sinistro nestes estágios ainda não foi enviado — o D+360 continua valendo (0269c). */
const SINISTRO_NAO_ENVIADO = new Set(['preparacao', 'notificado'])

interface TituloAberto {
  id: string
  numero: string | null
  vencimento: string
  valor_face: number
  sacado_cnpj: string
  sacado_matriz_cnpj: string
  sacado_nome: string | null
  sacado_empresa_id: string | null
  coberto_apolice: boolean
}

interface CobrancaAtiva {
  id: string
  codigo: string | null
  responsavel_id: string | null
}

type PrazoLido = {
  id: string
  titulo_id: string
  apolice_id: string
  cobranca_id: string | null
  causa: string
  vencimento_original: string
  data_parada_cobertura: string
  data_limite_notificacao: string
  data_perda: string
  data_limite_sinistro: string
  notificado_seguradora_em: string | null
  sinistro_id: string | null
  status: string
  alertas_emitidos: unknown
}

const COLUNAS_PRAZO =
  'id, titulo_id, apolice_id, cobranca_id, causa, vencimento_original, data_parada_cobertura, data_limite_notificacao, data_perda, data_limite_sinistro, notificado_seguradora_em, sinistro_id, status, alertas_emitidos'

function emitidos(v: unknown): Record<string, string> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {}
}

export async function relogioApolice(): Promise<ResultadoRelogio> {
  const hoje = hojeSaoPaulo()
  const cfg = await lerConfigCobranca()
  const r: ResultadoRelogio = {
    hoje,
    insolvencias_detectadas: 0,
    prazos_calculados: 0,
    titulos_sem_apolice: 0,
    prazos_encerrados: 0,
    avisos: 0,
    titulos_avisados: 0,
    prazos_perdidos: 0,
    avisos_perdido: 0,
    prazos_em_dia_pela_plataforma: 0,
  }

  const { data: apolicesBrutas, error: erroApolices } = await supabaseAdmin
    .from('apolices')
    .select(
      'id, numero, vigencia_inicio, vigencia_fim, ativa, periodo_espera_dias, periodo_max_prorrogacao_dias, prazo_notificacao_apos_prorrogacao_dias, prazo_envio_sinistro_meses',
    )
  if (erroApolices) throw new Error(`Falha ao ler as apólices: ${erroApolices.message}`)
  const apolices: ApoliceRelogio[] = apolicesBrutas ?? []

  const abertos = await todasAsPaginas<TituloAberto>((de, ate) =>
    supabaseAdmin
      .from('titulos')
      .select('id, numero, vencimento, valor_face, sacado_cnpj, sacado_matriz_cnpj, sacado_nome, sacado_empresa_id, coberto_apolice')
      .in('status', ['aberto', 'parcial'])
      .order('id')
      .range(de, ate),
  )

  // ── a) Insolvência ──────────────────────────────────────────────────────
  r.insolvencias_detectadas = await detectarInsolvencias(abertos)
  const { data: insolvencias } = await supabaseAdmin.from('cobranca_insolvencias').select('sacado_matriz_cnpj, data_decisao')
  const decisaoDo = new Map((insolvencias ?? []).map((i) => [i.sacado_matriz_cnpj, i.data_decisao]))

  // ── b) Os prazos dos títulos abertos, cobertos e vencidos ───────────────
  // Prazo só para título EM ATRASO (0275): o de ontem, ou o de sábado, pode estar pago e
  // compensando. As datas do prazo continuam contando do vencimento original.
  const vencidos = abertos.filter((t) => t.coberto_apolice && emAtraso(t.vencimento, hoje))
  const tituloPorId = new Map(abertos.map((t) => [t.id, t]))

  const ativos = await todasAsPaginas<{ titulo_id: string; cobranca_id: string }>((de, ate) =>
    supabaseAdmin
      .from('cobranca_titulos')
      .select('titulo_id, cobranca_id')
      .in('situacao', SITUACOES_ATIVAS)
      .order('id')
      .range(de, ate),
  )
  const cobrancaDoTitulo = new Map(ativos.map((a) => [a.titulo_id, a.cobranca_id]))
  const cobrancas = new Map<string, CobrancaAtiva>()
  for (const ids of lotes([...new Set(ativos.map((a) => a.cobranca_id))], 200)) {
    const { data } = await supabaseAdmin.from('cobrancas').select('id, codigo, responsavel_id').in('id', ids)
    for (const c of data ?? []) cobrancas.set(c.id, c)
  }

  const comCobranca: Record<string, unknown>[] = []
  const semCobranca: Record<string, unknown>[] = []
  for (const t of vencidos) {
    const apolice = escolherApolice(apolices, t.vencimento)
    if (!apolice) {
      r.titulos_sem_apolice++
      continue
    }
    const p = calcularPrazosApolice({
      vencimento_original: t.vencimento,
      apolice,
      insolvencia_data_decisao: decisaoDo.get(t.sacado_matriz_cnpj) ?? null,
    })
    /*
     * Só as colunas CALCULADAS. `notificado_seguradora_em`, `sinistro_id`, `status` e
     * `alertas_emitidos` são de quem age (as RPCs do sinistro) e da memória do relógio:
     * o upsert do PostgREST só escreve o que vem no corpo, e é isso que as preserva.
     */
    const linha = {
      apolice_id: p.apolice_id,
      titulo_id: t.id,
      causa: p.causa,
      vencimento_original: p.vencimento_original,
      data_parada_cobertura: p.data_parada_cobertura,
      data_limite_notificacao: p.data_limite_notificacao,
      data_perda: p.data_perda,
      data_limite_sinistro: p.data_limite_sinistro,
      calculado_em: new Date().toISOString(),
    }
    // Dois lotes, e não um: num upsert em lote o PostgREST completa com NULL a coluna
    // que falta numa linha — e o título fora de cobrança apagaria o vínculo que a RPC
    // da cobrança gravou num prazo antigo.
    const cobrancaId = cobrancaDoTitulo.get(t.id)
    if (cobrancaId) comCobranca.push({ ...linha, cobranca_id: cobrancaId })
    else semCobranca.push(linha)
  }

  const prazos: PrazoLido[] = []
  for (const lista of [comCobranca, semCobranca]) {
    for (const lote of lotes(lista, 500)) {
      const { data, error } = await supabaseAdmin
        .from('apolice_prazos')
        .upsert(lote as never, { onConflict: 'titulo_id,apolice_id' })
        .select(COLUNAS_PRAZO)
      if (error) throw new Error(`Falha ao gravar os prazos da apólice: ${error.message}`)
      prazos.push(...((data ?? []) as PrazoLido[]))
    }
  }
  r.prazos_calculados = prazos.length

  // ── c) Fechar o prazo do título que deixou de estar aberto ──────────────
  r.prazos_encerrados = await encerrarPrazosPagos(new Set(vencidos.map((t) => t.id)), hoje)

  // ── d) e e) Alertas e prazos perdidos ───────────────────────────────────
  const sinistroIds = [...new Set(prazos.map((p) => p.sinistro_id).filter((s): s is string => !!s))]
  const estagioDoSinistro = new Map<string, string>()
  for (const ids of lotes(sinistroIds, 200)) {
    const { data } = await supabaseAdmin.from('sinistros').select('id, estagio').in('id', ids)
    for (const s of data ?? []) estagioDoSinistro.set(s.id, s.estagio)
  }

  let reconciliacao = new Map<string, ReconciliacaoGrupo>()
  try {
    reconciliacao = await buscarReconciliacaoCobranca(supabaseAdmin)
  } catch (e) {
    logger.warn({ erro: e instanceof Error ? e.message : String(e) }, 'Reconciliação com a plataforma indisponível: o relógio avisa tudo.')
  }

  const paraAvisar: AlertaDeTitulo[] = []
  const perdidos: (AlertaDeTitulo & { marcoPerdido: string })[] = []
  const novosEmitidos = new Map<string, Record<string, string>>()
  const viraramPerdidos = new Set<string>()

  for (const p of prazos) {
    if (p.status !== 'ativo') continue
    const t = tituloPorId.get(p.titulo_id)
    if (!t) continue
    const cobrancaId = cobrancaDoTitulo.get(p.titulo_id) ?? null
    const cobranca = cobrancaId ? (cobrancas.get(cobrancaId) ?? null) : null
    const jaEmitidos = emitidos(p.alertas_emitidos)
    const estado: EstadoPrazo = {
      apolice_id: p.apolice_id,
      causa: p.causa as EstadoPrazo['causa'],
      vencimento_original: p.vencimento_original,
      data_parada_cobertura: p.data_parada_cobertura,
      data_limite_notificacao: p.data_limite_notificacao,
      data_perda: p.data_perda,
      data_limite_sinistro: p.data_limite_sinistro,
      notificado_seguradora_em: p.notificado_seguradora_em,
      sinistro_enviado: p.sinistro_id ? !SINISTRO_NAO_ENVIADO.has(estagioDoSinistro.get(p.sinistro_id) ?? 'preparacao') : false,
      alertas_emitidos: jaEmitidos,
    }
    const base = {
      prazo_id: p.id,
      titulo_id: t.id,
      numero: t.numero,
      sacado_matriz_cnpj: t.sacado_matriz_cnpj,
      sacado_nome: t.sacado_nome,
      empresa_id: t.sacado_empresa_id,
      valor_face: Number(t.valor_face),
      cobranca_id: cobranca?.id ?? null,
      cobranca_codigo: cobranca?.codigo ?? null,
      responsavel_id: cobranca?.responsavel_id ?? null,
    }

    if (!cobranca && reconciliacao.get(t.sacado_matriz_cnpj)?.situacao === 'em_dia') {
      r.prazos_em_dia_pela_plataforma++
      continue
    }

    // O prazo perdido vem ANTES dos alertas: avisar "faltam 5 dias" de um prazo que já
    // passou é pior que não avisar nada.
    const perdas = prazosPerdidos(estado, hoje)
    if (perdas.length > 0) {
      viraramPerdidos.add(p.id)
      const marcados = { ...jaEmitidos }
      for (const perda of perdas) {
        const chave = `perdido:${perda.marco}`
        if (chave in jaEmitidos) continue
        marcados[chave] = hoje
        perdidos.push({
          ...base,
          marcoPerdido: perda.marco,
          alerta: {
            chave,
            marco: perda.marco,
            nivel: 'critico',
            data_marco: perda.data_marco,
            dias_restantes: 0,
            mensagem: perda.mensagem,
          },
        })
      }
      novosEmitidos.set(p.id, marcados)
      continue
    }

    // Título fora de cobrança: a config decide se o relógio fala dele (§13).
    if (!cobranca && !cfg.apolice.alertar_titulos_fora_de_cobranca) continue
    for (const alerta of alertasDoDia(estado, hoje, cfg.apolice.alertas_dias)) {
      paraAvisar.push({ ...base, alerta })
    }
  }

  // ── Os avisos, agregados ──
  const prazoPorId = new Map(prazos.map((p) => [p.id, p]))
  for (const g of agruparAlertas(paraAvisar)) {
    const { titulo, resumo: texto } = textoDoAviso(g)
    // Parte do vencido já foi paga (0270): o aviso diz quanto a plataforma indica em
    // aberto, para ninguém tratar o total da lista como dívida.
    const rec = reconciliacao.get(g.sacado_matriz_cnpj)
    const resumo =
      rec?.situacao === 'parcial' && rec.vencido_estimado !== null
        ? `${texto} A plataforma indica cerca de ${formatarBrl(rec.vencido_estimado)} de fato vencido em aberto no grupo ` +
          `(de ${formatarBrl(rec.vencido)} listados).`
        : texto
    await avisar(
      g.nivel === 'critico' ? 'apolice.prazo_critico' : 'apolice.prazo_alerta',
      {
        titulo,
        resumo,
        url: g.cobranca_ids.length === 1 ? `/cobranca/cobrancas/${g.cobranca_ids[0]}` : '/cobranca',
        destinatarios: g.responsaveis,
        chave: chaveDoAviso(g, hoje),
        sacado_matriz_cnpj: g.sacado_matriz_cnpj,
        qtd_titulos: g.itens.length,
        valor: g.valor,
        marco: g.marco,
        marco_chave: g.chave,
        data_marco: g.data_marco,
        dias_restantes: g.dias_restantes,
        nivel: g.nivel,
        cobranca_ids: g.cobranca_ids,
      },
      { empresaId: g.empresa_id },
    )
    r.avisos++
    r.titulos_avisados += g.itens.length
    for (const item of g.itens) {
      const atual = novosEmitidos.get(item.prazo_id) ?? { ...emitidos(prazoPorId.get(item.prazo_id)?.alertas_emitidos) }
      atual[item.alerta.chave] = hoje
      novosEmitidos.set(item.prazo_id, atual)
    }
  }

  // ── Os perdidos, agregados: é FATO, vai para a timeline do sacado ──
  for (const g of agruparAlertas(perdidos)) {
    const quem = g.sacado_nome ?? formatarCnpjCobranca(g.sacado_matriz_cnpj)
    await registrarEvento(g.empresa_id, 'apolice.prazo_perdido', {
      titulo: `Prazo da apólice perdido: ${quem}`,
      resumo:
        `${g.mensagem} ${g.itens.length} título(s), ${formatarBrl(g.valor)}; o prazo venceu em ${formatarDataBr(g.data_marco)}.` +
        (g.cobranca_codigos.length ? ` Cobrança ${g.cobranca_codigos.join(', ')}.` : ''),
      url: g.cobranca_ids.length === 1 ? `/cobranca/cobrancas/${g.cobranca_ids[0]}` : '/cobranca',
      destinatarios: g.responsaveis,
      chave: `apolice:${g.chave}:${g.sacado_matriz_cnpj}`,
      sacado_matriz_cnpj: g.sacado_matriz_cnpj,
      qtd_titulos: g.itens.length,
      valor: g.valor,
      marco: g.marco,
      data_marco: g.data_marco,
      cobranca_ids: g.cobranca_ids,
      // A cronologia do dossiê lê por `cobranca_id`: com uma cobrança só, o fato entra nela.
      ...(g.cobranca_ids.length === 1 ? { cobranca_id: g.cobranca_ids[0] } : {}),
    })
    r.avisos_perdido++
  }

  // ── A memória do relógio ──
  const escritas = [...novosEmitidos.entries()]
  for (const lote of lotes(escritas, 20)) {
    await Promise.all(
      lote.map(async ([id, alertas]) => {
        const patch: Record<string, unknown> = { alertas_emitidos: alertas }
        if (viraramPerdidos.has(id)) patch.status = 'perdido'
        const { error } = await supabaseAdmin.from('apolice_prazos').update(patch as never).eq('id', id)
        if (error) logger.error({ prazo: id, erro: error.message }, 'Falha ao gravar a memória do relógio.')
      }),
    )
  }
  r.prazos_perdidos = viraramPerdidos.size

  logger.info(r, 'Relógio da apólice atualizado.')
  return r
}

/**
 * Insolvência detectada no Jurídico (§6.1): processo de falência ou recuperação judicial
 * contra um CNPJ de grupo com título aberto.
 *
 * A data usada é a da DISTRIBUIÇÃO, que é anterior à decisão — e por isso encurta o
 * prazo do sinistro: errar para o lado seguro (0269a). `confirmada = false` pede a uma
 * pessoa que troque pela data da decisão. Um registro que já existe (manual ou de outra
 * detecção) nunca é tocado.
 */
async function detectarInsolvencias(abertos: readonly TituloAberto[]): Promise<number> {
  const { data: processos, error } = await supabaseAdmin
    .from('processos')
    .select('numero_cnj, classe, cnpj_devedor, empresa_devedora_id, data_distribuicao, data_inicio')
    .or('classe.ilike.*fal*ncia*,classe.ilike.*recupera*judicial*')
  if (error) {
    logger.error({ erro: error.message }, 'Não li os processos para detectar insolvência; o relógio segue.')
    return 0
  }
  const candidatos = (processos ?? []).filter((p) => tipoInsolvenciaDaClasse(p.classe) !== null)
  if (candidatos.length === 0) return 0

  // CNPJ → cabeça do grupo, pelo que os títulos abertos dizem. A raiz (8 dígitos) pega a
  // falência da matriz de um grupo cujos títulos são todos de filiais.
  const matrizDoCnpj = new Map<string, string>()
  const matrizDaRaiz = new Map<string, string>()
  const empresaDaMatriz = new Map<string, string | null>()
  for (const t of abertos) {
    matrizDoCnpj.set(t.sacado_cnpj, t.sacado_matriz_cnpj)
    matrizDoCnpj.set(t.sacado_matriz_cnpj, t.sacado_matriz_cnpj)
    matrizDaRaiz.set(t.sacado_cnpj.slice(0, 8), t.sacado_matriz_cnpj)
    matrizDaRaiz.set(t.sacado_matriz_cnpj.slice(0, 8), t.sacado_matriz_cnpj)
    if (!empresaDaMatriz.get(t.sacado_matriz_cnpj)) empresaDaMatriz.set(t.sacado_matriz_cnpj, t.sacado_empresa_id)
  }

  const semCnpj = candidatos.filter((p) => !p.cnpj_devedor && p.empresa_devedora_id).map((p) => p.empresa_devedora_id!)
  const cnpjDaEmpresa = new Map<string, string>()
  if (semCnpj.length) {
    const { data } = await supabaseAdmin.from('empresas').select('id, cnpj').in('id', semCnpj)
    for (const e of data ?? []) if (e.cnpj) cnpjDaEmpresa.set(e.id, e.cnpj)
  }

  const porMatriz = new Map<string, { tipo: string; data: string; cnj: string; classe: string }>()
  for (const p of candidatos) {
    const cnpj = p.cnpj_devedor ?? (p.empresa_devedora_id ? cnpjDaEmpresa.get(p.empresa_devedora_id) : undefined)
    if (!cnpj) continue
    const matriz = matrizDoCnpj.get(cnpj) ?? matrizDaRaiz.get(cnpj.slice(0, 8))
    const data = (p.data_distribuicao ?? p.data_inicio)?.slice(0, 10)
    if (!matriz || !data) continue
    const atual = porMatriz.get(matriz)
    // A data mais ANTIGA ganha: o prazo mais curto é o que não se perde.
    if (!atual || data < atual.data) {
      porMatriz.set(matriz, { tipo: tipoInsolvenciaDaClasse(p.classe)!, data, cnj: p.numero_cnj, classe: p.classe ?? '' })
    }
  }
  if (porMatriz.size === 0) return 0

  const { data: inseridas, error: erroInsert } = await supabaseAdmin
    .from('cobranca_insolvencias')
    .upsert(
      [...porMatriz.entries()].map(([matriz, v]) => ({
        sacado_matriz_cnpj: matriz,
        tipo: v.tipo,
        data_decisao: v.data,
        fonte: 'juridico',
        numero_cnj: v.cnj,
        confirmada: false,
        observacao: `Detectada pela classe "${v.classe}" do processo ${v.cnj}. Data de distribuição usada no lugar da decisão — confirme.`,
      })),
      { onConflict: 'sacado_matriz_cnpj', ignoreDuplicates: true },
    )
    .select('sacado_matriz_cnpj, tipo, data_decisao, numero_cnj')
  if (erroInsert) {
    logger.error({ erro: erroInsert.message }, 'Falha ao registrar insolvência detectada; o relógio segue.')
    return 0
  }

  for (const i of inseridas ?? []) {
    await registrarEvento(empresaDaMatriz.get(i.sacado_matriz_cnpj) ?? null, 'apolice.insolvencia_detectada', {
      titulo: 'Possível insolvência de sacado em cobrança',
      resumo:
        `${i.tipo === 'falencia' ? 'Falência' : 'Recuperação judicial'} no processo ${i.numero_cnj ?? '—'}. ` +
        `O relógio passou a contar a Data da Perda de ${formatarDataBr(i.data_decisao)} (distribuição) — ` +
        'confirme a data da decisão judicial.',
      url: '/cobranca',
      chave: `apolice.insolvencia:${i.sacado_matriz_cnpj}`,
      sacado_matriz_cnpj: i.sacado_matriz_cnpj,
      numero_cnj: i.numero_cnj,
      data_decisao: i.data_decisao,
    })
  }
  return inseridas?.length ?? 0
}

/**
 * §6.3 item 2: o título deixou de estar aberto. Fecha o prazo e grava a partir de
 * quando a cobertura volta — com efeito retroativo se o pagamento entrou até 30 dias
 * depois da parada de D+60 SEM o sacado ter sido posto em cobrança (cl. 17700.20 a); a
 * interrupção por cobrança (cl. 17700.20 b) nunca retroage.
 */
async function encerrarPrazosPagos(abertosVencidos: ReadonlySet<string>, hoje: string): Promise<number> {
  const ativos = await todasAsPaginas<{ id: string; titulo_id: string; data_parada_cobertura: string }>((de, ate) =>
    supabaseAdmin
      .from('apolice_prazos')
      .select('id, titulo_id, data_parada_cobertura')
      .eq('status', 'ativo')
      .order('id')
      .range(de, ate),
  )
  const suspeitos = ativos.filter((p) => !abertosVencidos.has(p.titulo_id))
  if (suspeitos.length === 0) return 0

  const titulos = new Map<string, { status: string; pago_em: string | null }>()
  const emCobrancaDesde = new Map<string, string>()
  for (const ids of lotes([...new Set(suspeitos.map((p) => p.titulo_id))], 200)) {
    const { data } = await supabaseAdmin.from('titulos').select('id, status, pago_em').in('id', ids)
    for (const t of data ?? []) titulos.set(t.id, t)
    const { data: cts } = await supabaseAdmin
      .from('cobranca_titulos')
      .select('titulo_id, cobrancas!inner(notificada_em)')
      .in('titulo_id', ids)
    for (const ct of cts ?? []) {
      const d = dataSp((ct.cobrancas as { notificada_em: string | null } | null)?.notificada_em)
      if (!d) continue
      const atual = emCobrancaDesde.get(ct.titulo_id)
      if (!atual || d < atual) emCobrancaDesde.set(ct.titulo_id, d)
    }
  }

  let n = 0
  for (const p of suspeitos) {
    const t = titulos.get(p.titulo_id)
    if (!t || !['pago', 'recomprado', 'cancelado'].includes(t.status)) continue
    const pagoEm = t.pago_em ?? hoje
    const volta = restabelecimentoCobertura({
      pago_em: pagoEm,
      data_parada_cobertura: p.data_parada_cobertura,
      em_cobranca_desde: emCobrancaDesde.get(p.titulo_id) ?? null,
    })
    const { error } = await supabaseAdmin
      .from('apolice_prazos')
      .update({
        status: 'encerrado_pagamento',
        pago_em: pagoEm,
        restabelecimento_retroativo: volta.retroativo,
        cobertura_volta_em: volta.cobertura_volta_em,
        calculado_em: new Date().toISOString(),
      })
      .eq('id', p.id)
      .eq('status', 'ativo')
    if (error) logger.error({ prazo: p.id, erro: error.message }, 'Falha ao encerrar prazo pago.')
    else n++
  }
  return n
}
