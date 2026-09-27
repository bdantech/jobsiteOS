/**
 * Formatações das telas de GESTÃO dos Agentes (Personas, Materiais, Desempenho,
 * Configurações). As de Ao vivo e Mandatos moram em `format.ts`, de outra frente — as
 * duas não se importam para que nenhuma mudança de uma quebre a outra em silêncio.
 *
 * Dinheiro no módulo é SEMPRE centavos inteiros (orçamento, gasto, preço de ferramenta).
 * A tela converte na borda: mostra reais, lê reais, grava centavos. Um campo que
 * aceitasse centavos crus seria um teto mensal cem vezes maior do que alguém quis.
 */

export function brlCentavos(c: number | string | null | undefined, casas = 2): string {
  if (c === null || c === undefined || c === '' || !Number.isFinite(Number(c))) return '—'
  return (Number(c) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}

/** 0.123 → "12,3%". Nulo continua "—": taxa sem denominador não é zero. */
export function pct(v: number | string | null | undefined, casas = 1): string {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—'
  return `${(Number(v) * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`
}

export function inteiro(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR')
}

export function dataCurta(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

export function dataHora(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

/**
 * "1.234,56", "1234.56" e "1234,5" → número. Com vírgula, o ponto é milhar; sem vírgula,
 * o ponto é decimal. Vazio ou lixo → null (nunca 0: zero é um valor, e um teto zero para
 * todas as ferramentas pagas).
 */
export function numeroBr(texto: string): number | null {
  const t = texto.trim()
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

/** Reais digitados → centavos inteiros. Null se o texto não for número. */
export function centavosDeTexto(texto: string): number | null {
  const n = numeroBr(texto)
  if (n === null || n < 0) return null
  return Math.round(n * 100)
}

/** Centavos → texto editável em reais ("1234,50"), sem símbolo nem milhar. */
export function textoDeCentavos(c: number | null | undefined): string {
  if (c === null || c === undefined || !Number.isFinite(c)) return ''
  return (c / 100).toFixed(2).replace('.', ',')
}

/** Horas decimais em leitura humana: 3,5 → "3h30"; 50 → "2d 2h". */
export function horas(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '—'
  const h = Number(v)
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) {
    const inteiras = Math.floor(h)
    const min = Math.round((h - inteiras) * 60)
    return min > 0 ? `${inteiras}h${String(min).padStart(2, '0')}` : `${inteiras}h`
  }
  const d = Math.floor(h / 24)
  return `${d}d ${Math.round(h - d * 24)}h`
}

/** Nome de arquivo seguro para o Storage: sem acento, sem espaço, sem barra. */
export function nomeDeArquivoSeguro(nome: string): string {
  const semAcento = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const limpo = semAcento.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-')
  return limpo.replace(/^-|-$/g, '').slice(0, 120) || 'arquivo'
}

export function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf('.')
  return i >= 0 ? nome.slice(i + 1).toLowerCase() : ''
}
