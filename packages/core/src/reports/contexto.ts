import {
  PLATAFORMAS_REPORT,
  type ContextoReport,
  type PlataformaReport,
} from './schemas.js'

/**
 * O contexto técnico do report (04m §2), montado igual nas duas plataformas.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO: só entra o que descreve ONDE o usuário
 * estava, nunca QUEM ele é nem o que ele tinha em mãos. Nada de token, cookie,
 * localStorage, id de sessão ou corpo de requisição. O campo é anexado a um
 * texto que o autor escreveu para ser lido por outra pessoa — tudo que cair aqui
 * é distribuído junto, e nem o autor nem o leitor conferem o que veio.
 *
 * Por que um helper compartilhado em vez de cada app montar o seu: os dois lados
 * gravam na MESMA coluna e o painel de triagem lê os dois com a mesma tela. Duas
 * implementações são duas formas do mesmo objeto, e a segunda a divergir vira
 * uma linha em branco no painel sem ninguém perceber.
 */

export interface EntradaContexto {
  /** Rota lógica: `/comercial/fornecedores`. No mobile, o pathname do expo-router. */
  rota?: string | null
  /** URL completa. No mobile normalmente não existe, e ausente é melhor que inventada. */
  url?: string | null
  plataforma?: string | null
  userAgent?: string | null
  viewport?: { largura?: number | null; altura?: number | null } | null
  appVersao?: string | null
}

/** `Platform.OS` do RN e o `web` do navegador caem nas quatro que a coluna aceita. */
function normalizarPlataforma(valor: string | null | undefined): PlataformaReport {
  const v = (valor ?? '').trim().toLowerCase()
  return (PLATAFORMAS_REPORT as readonly string[]).includes(v)
    ? (v as PlataformaReport)
    : 'desconhecida'
}

function texto(valor: string | null | undefined, limite: number): string | null {
  const v = (valor ?? '').trim()
  if (v.length === 0) return null
  return v.length > limite ? v.slice(0, limite) : v
}

/**
 * Viewport como "1440×900".
 *
 * Dimensões fracionárias existem de verdade (zoom do navegador, densidade de
 * tela do Android) e "1439.2×899.5" não ajuda ninguém a reproduzir nada.
 * Arredondar é o que torna o número comparável entre dois reports.
 */
function medida(viewport: EntradaContexto['viewport']): string | null {
  const l = viewport?.largura
  const a = viewport?.altura
  if (typeof l !== 'number' || typeof a !== 'number') return null
  if (!Number.isFinite(l) || !Number.isFinite(a) || l <= 0 || a <= 0) return null
  return `${Math.round(l)}×${Math.round(a)}`
}

export function montarContexto(entrada: EntradaContexto): ContextoReport {
  return {
    rota: texto(entrada.rota, 200),
    url: texto(entrada.url, 500),
    plataforma: normalizarPlataforma(entrada.plataforma),
    // O user agent é longo e repetitivo; 500 caracteres cobrem qualquer navegador
    // real com folga e evitam que uma string patológica ocupe o campo inteiro.
    user_agent: texto(entrada.userAgent, 500),
    viewport: medida(entrada.viewport),
    app_versao: texto(entrada.appVersao, 40),
  }
}

/**
 * O contexto em linhas de rótulo/valor, para a seção colapsada "detalhes técnicos
 * incluídos automaticamente" (§2) e para o detalhe do admin (§3).
 *
 * Campo vazio NÃO vira "—": ele some. Uma lista de traços faz o leitor procurar
 * o que não existe; a lista curta diz o que foi capturado, e ponto.
 */
export function linhasDoContexto(
  contexto: Partial<ContextoReport> | null | undefined,
): { rotulo: string; valor: string }[] {
  if (!contexto) return []
  const pares: [string, string | null | undefined][] = [
    ['Rota', contexto.rota],
    ['URL', contexto.url],
    ['Plataforma', contexto.plataforma],
    ['Versão', contexto.app_versao],
    ['Tela', contexto.viewport],
    ['Navegador', contexto.user_agent],
  ]
  return pares
    .filter((par): par is [string, string] => typeof par[1] === 'string' && par[1].length > 0)
    .map(([rotulo, valor]) => ({ rotulo, valor }))
}
