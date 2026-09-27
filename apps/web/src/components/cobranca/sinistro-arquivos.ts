import { toast } from 'sonner'
import { urlAssinada } from './gestao-queries'

/** Abre um arquivo do bucket privado `cobrancas` por URL assinada de 5 minutos. */
export async function abrirArquivo(caminho: string): Promise<void> {
  const url = await urlAssinada(caminho)
  if (!url) {
    toast.error('Não foi possível gerar o link do arquivo.')
    return
  }
  window.open(url, '_blank', 'noopener')
}

/**
 * "1.234,56", "1234.56" e "1234,5" → número. Com vírgula, o ponto é milhar; sem
 * vírgula, o ponto é decimal. Vazio ou lixo → null (nunca 0: zero é um valor).
 */
export function numeroBr(texto: string): number | null {
  const t = texto.trim()
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}
