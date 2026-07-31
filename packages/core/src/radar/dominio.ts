/**
 * O domínio de uma empresa — normalização e o que os e-mails dos contatos dizem sobre ele.
 *
 * Este arquivo existe porque a mesma regra ("o que conta como domínio corporativo")
 * era necessária em três lugares: a cascata de resolução no worker, a edição manual na
 * ficha e a tela que compara o domínio salvo com o dos contatos. Três cópias da lista de
 * provedores genéricos é como um `@gmail.com` acaba virando o domínio de uma construtora
 * em exatamente um dos três caminhos — e ninguém descobre qual.
 */

/**
 * Provedores de e-mail que NÃO dizem nada sobre a empresa. A raiz do domínio (antes do
 * primeiro ponto) é o que se compara, para pegar `gmail.com` e `gmail.com.br` de uma vez.
 */
export const PROVEDORES_EMAIL_GENERICOS: readonly string[] = [
  'gmail', 'hotmail', 'outlook', 'live', 'yahoo', 'uol', 'terra', 'bol', 'ig', 'globo',
  'r7', 'msn', 'icloud', 'aol', 'protonmail', 'proton', 'zipmail', 'oi', 'superig',
  'itelefonica', 'me', 'mac', 'gmx', 'yandex', 'zoho', 'mail',
]

const GENERICOS = new Set(PROVEDORES_EMAIL_GENERICOS)

/**
 * O host puro: sem esquema, sem caminho, sem porta, sem `www.`, minúsculo.
 *
 * O `www.` importa mais do que parece. `organizations/enrich?domain=www.acme.com.br` não
 * acha nada no Apollo — e o job volta `sem_dados` em silêncio, indistinguível de uma
 * empresa que o Apollo realmente não conhece. Um prefixo de três letras vira "esta
 * empresa não tem headcount", para sempre.
 */
export function normalizarDominio(valor: string | null | undefined): string | null {
  if (!valor) return null
  const host = valor
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split('/')[0]
    ?.split('?')[0]
    ?.split('#')[0]
    ?.split(':')[0]
    ?.replace(/^www\./, '')
    .replace(/\.+$/, '')
  if (!host) return null
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
}

/**
 * A raiz é comparada para pegar `gmail.com` e `gmail.com.br` com uma entrada só — mas o
 * limite de três rótulos é o que impede `mail.construtora.com.br` (quatro) de ser
 * descartado como se fosse `mail.com`. Um subdomínio de e-mail corporativo é justamente
 * o tipo de endereço que a empresa usa, e perdê-lo apagaria a evidência mais forte.
 */
function ehProvedorGenerico(host: string): boolean {
  const partes = host.split('.')
  return partes.length <= 3 && GENERICOS.has(partes[0] as string)
}

/**
 * O domínio corporativo de um e-mail, ou null quando ele não diz nada — endereço
 * malformado ou provedor genérico. Null é resposta, não falha: um contato no Gmail é
 * um contato válido cujo e-mail simplesmente não identifica a empresa.
 */
export function dominioDeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const arroba = email.trim().toLowerCase().split('@')
  if (arroba.length !== 2) return null
  const host = normalizarDominio(arroba[1])
  if (!host) return null
  return ehProvedorGenerico(host) ? null : host
}

// ─── O que os contatos dizem sobre o domínio salvo ──────────────────────────

export interface ContatoComEmail {
  empresaId: string
  email: string | null
}

export interface EmpresaComDominio {
  id: string
  dominio: string | null
}

/**
 * Por que três casos e não só "divergente":
 *
 *  - `ausente`    — não há domínio salvo e os contatos sabem qual é. É o volume: na base
 *                   real são ~174 empresas contra 4 divergências. O e-mail já estava lá.
 *  - `malformado` — o salvo aponta para o MESMO lugar, escrito de um jeito que quebra a
 *                   consulta (`www.acme.com.br`). Some da lista se a comparação for feita
 *                   já normalizada, e continua quebrando o enriquecimento em silêncio.
 *  - `divergente` — são domínios diferentes de verdade. Aqui adotar pode estar ERRADO: uma
 *                   construtora cujo contato usa o domínio da marca de vendas tem os dois
 *                   corretos, cada um para uma coisa. Por isso é sugestão, nunca automático.
 */
export type CasoDominio = 'ausente' | 'malformado' | 'divergente'

export const CASO_DOMINIO_LABELS: Record<CasoDominio, string> = {
  ausente: 'Sem domínio salvo',
  malformado: 'Mesmo domínio, forma quebrada',
  divergente: 'Domínio diferente',
}

export interface CandidatoDominio {
  dominio: string
  contatos: number
}

export interface SugestaoDominio {
  empresaId: string
  caso: CasoDominio
  /** Exatamente como está gravado — inclusive `www.`, que é metade do ponto. */
  dominioAtual: string | null
  /** O candidato mais forte: mais contatos; empate resolvido em ordem alfabética. */
  sugerido: string
  contatosSugerido: number
  /** Quantos contatos usam o domínio já salvo. Zero é o sinal de que ninguém o usa. */
  contatosNoAtual: number
  candidatos: CandidatoDominio[]
}

/**
 * Cruza contatos com empresas e devolve, por empresa, o domínio que os e-mails sugerem.
 *
 * Não emite sugestão quando o domínio salvo já é o mais usado pelos contatos — que é o
 * caso da esmagadora maioria e não é notícia nenhuma.
 */
export function sugerirDominiosPorContato(
  contatos: readonly ContatoComEmail[],
  empresas: readonly EmpresaComDominio[],
): SugestaoDominio[] {
  const porEmpresa = new Map<string, Map<string, number>>()
  for (const c of contatos) {
    const dom = dominioDeEmail(c.email)
    if (!dom) continue
    const mapa = porEmpresa.get(c.empresaId) ?? new Map<string, number>()
    mapa.set(dom, (mapa.get(dom) ?? 0) + 1)
    porEmpresa.set(c.empresaId, mapa)
  }

  const sugestoes: SugestaoDominio[] = []

  for (const empresa of empresas) {
    const contagem = porEmpresa.get(empresa.id)
    if (!contagem || contagem.size === 0) continue

    const candidatos: CandidatoDominio[] = [...contagem.entries()]
      .map(([dominio, n]) => ({ dominio, contatos: n }))
      .sort((a, b) => b.contatos - a.contatos || a.dominio.localeCompare(b.dominio))

    const melhor = candidatos[0]
    if (!melhor) continue

    const atualNormalizado = normalizarDominio(empresa.dominio)

    // O domínio salvo já é o que os contatos usam: nada a dizer.
    if (atualNormalizado === melhor.dominio && empresa.dominio === atualNormalizado) continue

    const caso: CasoDominio =
      atualNormalizado === null
        ? 'ausente'
        : atualNormalizado === melhor.dominio
          ? 'malformado'
          : 'divergente'

    sugestoes.push({
      empresaId: empresa.id,
      caso,
      dominioAtual: empresa.dominio ?? null,
      sugerido: melhor.dominio,
      contatosSugerido: melhor.contatos,
      contatosNoAtual: atualNormalizado ? (contagem.get(atualNormalizado) ?? 0) : 0,
      candidatos,
    })
  }

  return sugestoes
}
