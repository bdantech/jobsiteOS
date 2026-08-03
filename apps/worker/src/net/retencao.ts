import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Retenção do volume de downloads.
 *
 * O volume do Railway tem 20 GB e o dump da Receita ocupa ~8 GB por mês. Como o
 * destino do download carrega o mês (`2026-08/Empresas0.zip`), cada execução
 * mensal criava uma pasta NOVA ao lado da anterior e nada apagava a velha: 8 GB
 * em julho, 16 em agosto, e em setembro o disco enche NO MEIO de um download —
 * que é o pior momento possível, porque o erro de escrita entra no backoff de
 * horas do download.ts e a ingestão só falha ~10h depois.
 *
 * A regra é: sobrevive o mês da execução, e mais nada. Rodar isto ANTES de
 * baixar (e não depois de ingerir) é o ponto todo — é o que garante espaço livre
 * na hora em que ele é preciso. O mês corrente fica no disco depois do sucesso de
 * propósito: são 8 GB parados que compram um re-run barato no mesmo mês, contra
 * ~10h de download num servidor lento.
 *
 * O `.parcial` de um download interrompido NÃO é lixo — é a retomada por `Range`.
 * Por isso nada é apagado dentro da pasta do mês corrente: a limpeza remove
 * pastas inteiras de OUTROS meses, nunca arquivos soltos da atual.
 */

const PASTA_MES = /^\d{4}-\d{2}$/

/** Nunca apagadas: não são dump de mês. `amostra` é o modo de teste (sample). */
const PRESERVADAS = new Set(['amostra'])

/**
 * `cno` é o caminho LEGADO, de quando o CNO baixava para um destino sem mês. Ele
 * some junto — e essa é justamente a correção: com destino fixo, o download
 * reaproveitava o zip do mês anterior e a ingestão do CNO reportava sucesso
 * relendo dado velho.
 */
const LEGADAS = new Set(['cno'])

export function deveRemover(nome: string, mesAtual: string): boolean {
  if (PRESERVADAS.has(nome)) return false
  if (LEGADAS.has(nome)) return true
  if (!PASTA_MES.test(nome)) return false
  return nome !== mesAtual
}

export interface ResultadoRetencao {
  /** Nomes das pastas removidas, na ordem em que saíram. */
  removidos: string[]
  bytes_liberados: number
}

/** Soma recursiva. Só serve para o log — por isso um erro aqui não impede a remoção. */
async function tamanhoDe(caminho: string): Promise<number> {
  let total = 0
  const entradas = await readdir(caminho, { withFileTypes: true }).catch(() => [])
  for (const entrada of entradas) {
    const filho = join(caminho, entrada.name)
    if (entrada.isDirectory()) total += await tamanhoDe(filho)
    else total += await stat(filho).then((s) => s.size, () => 0)
  }
  return total
}

/**
 * Apaga de `dir` toda pasta de dump que não seja a de `mesAtual`. Idempotente, e
 * silenciosa quando o diretório ainda não existe (primeira execução da máquina).
 */
export async function reterApenas(dir: string, mesAtual: string): Promise<ResultadoRetencao> {
  // Um mês malformado apagaria TODAS as pastas de mês, inclusive a que está sendo
  // baixada agora. Falhar aqui é barato; descobrir depois de 8 GB no lixo, não.
  if (!PASTA_MES.test(mesAtual)) {
    throw new Error(`Mês inválido para a retenção do volume: "${mesAtual}" (esperado YYYY-MM).`)
  }

  const entradas = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const resultado: ResultadoRetencao = { removidos: [], bytes_liberados: 0 }

  for (const entrada of entradas) {
    // Só diretórios: um arquivo solto na raiz do volume não é nosso e não é problema nosso.
    if (!entrada.isDirectory()) continue
    if (!deveRemover(entrada.name, mesAtual)) continue

    const caminho = join(dir, entrada.name)
    const bytes = await tamanhoDe(caminho)
    await rm(caminho, { recursive: true, force: true })

    resultado.removidos.push(entrada.name)
    resultado.bytes_liberados += bytes
  }

  return resultado
}
