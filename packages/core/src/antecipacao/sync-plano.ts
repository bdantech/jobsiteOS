import { CONFIG_SYNC_PADRAO, type ConfigSync } from './schemas.js'

/**
 * O PLANO de requisições ao endpoint de NFs.
 *
 * Vive no core e não no worker porque é onde está o teste: esta é a parte do sync
 * que codifica o CONTRATO de uma API de terceiro, e contrato errado é o tipo de
 * bug que não aparece em typecheck nem em review — aparece como 400 em produção,
 * ou pior, como notas que simplesmente não chegam.
 *
 * O endpoint oferece dois filtros MUTUAMENTE EXCLUSIVOS (mandar os dois → 400):
 *
 *   sync_hours=N          notas SINCRONIZADAS nas últimas N horas. N ∈ [1, 4].
 *   start_date/end_date   notas EMITIDAS no intervalo. Máximo de 10 dias.
 *
 * O incremental é o `sync_hours` — é literalmente a pergunta que o job faz ("o
 * que entrou desde a última corrida?"). Mas ele tem teto de 4 horas e o cron roda
 * de 4 em 4: a cobertura é contígua e SEM FOLGA. Qualquer atraso ou falha abre um
 * buraco que nenhum `sync_hours` alcança depois — 4h é todo o passado que esse
 * filtro sabe olhar.
 *
 * Daí os três modos:
 *
 *   incremental  gap ≤ teto → `sync_hours = ceil(gap)`. O arredondamento para
 *                cima É o colchão possível (até ~1h), dentro do teto.
 *   recuperacao  gap > teto (corrida falhou/atrasou) ou primeira execução → cai
 *                para a janela por EMISSÃO, fatiada em blocos de ≤10 dias.
 *   varredura    a rede de segurança do job diário: revarre a janela de emissão
 *                dos últimos N dias, fechando em até 24h o buraco que o teto de
 *                4h tenha deixado.
 *
 * Tudo isso é barato porque o processamento é idempotente por `access_key`:
 * sobrepor não duplica nada, só reescreve a mesma linha.
 */

export type ModoSync = 'incremental' | 'varredura'

export type RequisicaoSync =
  | { tipo: 'sync_hours'; horas: number }
  | { tipo: 'datas'; de: string; ate: string }

export interface PlanoSync {
  modo: 'incremental' | 'recuperacao' | 'varredura'
  requisicoes: RequisicaoSync[]
  /** Para o log e para o `meta` da ingestão — é o que explica uma corrida estranha. */
  descricao: string
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Fatia [de, ate] em blocos de no máximo `maxDias` dias, INCLUSIVOS nas duas
 * pontas (é assim que o endpoint trata `start_date`/`end_date`). Um bloco de 10
 * dias vai de D a D+9, não D+10 — a diferença é justamente o que faz a requisição
 * passar ou tomar 400.
 */
export function fatiarJanela(de: Date, ate: Date, maxDias: number): RequisicaoSync[] {
  const passo = Math.max(1, maxDias)
  const blocos: RequisicaoSync[] = []
  let inicio = new Date(de)

  while (inicio <= ate) {
    const fim = new Date(Math.min(inicio.getTime() + (passo - 1) * 86_400_000, ate.getTime()))
    blocos.push({ tipo: 'datas', de: iso(inicio), ate: iso(fim) })
    inicio = new Date(fim.getTime() + 86_400_000)
  }

  return blocos
}

export function montarPlanoSync(input: {
  modo: ModoSync
  /** Último `onepay_nf` concluído. null = nunca rodou com sucesso. */
  ultimoSync: Date | null
  agora: Date
  cfg?: ConfigSync
}): PlanoSync {
  const cfg = input.cfg ?? CONFIG_SYNC_PADRAO
  const { agora } = input

  if (input.modo === 'varredura') {
    const de = new Date(agora.getTime() - cfg.varredura_dias * 86_400_000)
    return {
      modo: 'varredura',
      requisicoes: fatiarJanela(de, agora, cfg.intervalo_max_dias),
      descricao: `varredura por emissão dos últimos ${cfg.varredura_dias} dias`,
    }
  }

  if (!input.ultimoSync) {
    const de = new Date(agora.getTime() - cfg.janela_inicial_dias * 86_400_000)
    return {
      modo: 'recuperacao',
      requisicoes: fatiarJanela(de, agora, cfg.intervalo_max_dias),
      descricao: `primeira execução: janela por emissão de ${cfg.janela_inicial_dias} dias`,
    }
  }

  const gapHoras = (agora.getTime() - input.ultimoSync.getTime()) / 3_600_000

  if (gapHoras <= cfg.sync_horas_max) {
    const horas = Math.min(cfg.sync_horas_max, Math.max(1, Math.ceil(gapHoras)))
    return {
      modo: 'incremental',
      requisicoes: [{ tipo: 'sync_hours', horas }],
      descricao: `incremental: sincronizadas nas últimas ${horas}h (gap de ${gapHoras.toFixed(1)}h)`,
    }
  }

  // O buraco é maior do que o `sync_hours` alcança. Recupera por EMISSÃO, que é
  // uma APROXIMAÇÃO: pega o que foi emitido no período, não o que foi
  // sincronizado nele. Uma nota antiga sincronizada durante o buraco só volta na
  // varredura diária — e é exatamente por isso que a varredura existe.
  const dias = Math.min(cfg.janela_inicial_dias, Math.ceil(gapHoras / 24) + 1)
  const de = new Date(agora.getTime() - dias * 86_400_000)
  return {
    modo: 'recuperacao',
    requisicoes: fatiarJanela(de, agora, cfg.intervalo_max_dias),
    descricao:
      `recuperação: gap de ${gapHoras.toFixed(1)}h excede o teto de ${cfg.sync_horas_max}h — ` +
      `janela por emissão de ${dias} dias`,
  }
}

/** Os parâmetros da query, com os nomes que o endpoint espera. */
export function querystringSync(req: RequisicaoSync, page: number, pageSize: number): string {
  const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  // `sync_hours` SUBSTITUI o filtro de datas. Mandar os dois é 400 — por isso o
  // tipo é uma união, e não um objeto com os três campos opcionais.
  if (req.tipo === 'sync_hours') p.set('sync_hours', String(req.horas))
  else {
    p.set('start_date', req.de)
    p.set('end_date', req.ate)
  }
  return p.toString()
}
