// Caminhos ESPECÍFICOS, nunca o barrel do core: `src/index.js` reexporta o registry,
// que importa `zod-to-json-schema` — dependência que o worker não tem.
import { fetch } from 'undici'
import {
  AMBIENTES_SEGURADORA,
  PAIS_SEGURADORA_BR,
} from '../../../../../packages/core/src/credito/seguradora.js'
import type {
  AmbienteSeguradora,
  BuyerSeguradora,
  DecisaoSeguradora,
  EstagioSeguradora,
  PedidoCobertura,
  ResultadoSeguradora,
  Seguradora,
} from '../../../../../packages/core/src/credito/seguradora.js'
import { lerIntegracaoSeguradora } from '../../credito/config.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'

/**
 * Provedor Atradius (04d §4.2), atrás da interface `Seguradora` do core.
 *
 * ── LEIA ANTES DE MEXER ──────────────────────────────────────────────────────────
 * O portal de desenvolvedores da Atradius (api.atradius.com/developers) exige cadastro
 * para liberar os handbooks do Buyer e do Cover API. Sem credenciais não houve como
 * confirmar caminho de rota, nomes de campo nem formato de paginação. O que está aqui é
 * a forma documentada publicamente (OAuth2 client credentials + REST por apólice), e
 * TODA a superfície que pode divergir está isolada em `ROTAS` e nos três `mapear*`
 * abaixo — corrigir contra o handbook real é editar este arquivo e nada mais.
 *
 * A esteira inteira funciona sem isto: sem credencial, `configurada()` devolve false e o
 * envio explica o que falta, em vez de estourar um erro de rede que parece um bug.
 *
 * ── A REGRA DE CUSTO ─────────────────────────────────────────────────────────────
 * `resolverBuyer` PODE SER COBRADO. Ele é chamado em UM lugar: o envio de uma análise,
 * que é um clique humano. Não há busca aberta de buyer neste arquivo, e não há por
 * descuido — a interface do core sequer tem um método para isso.
 *
 * ── A APÓLICE É DESCOBERTA, NÃO CONFIGURADA ──────────────────────────────────────
 * O id da apólice não aparece no portal de desenvolvedores, e a própria API sabe informá-lo
 * (`policy-management/v1/policies/details`). Então `apoliceVigente()` pergunta e cacheia por
 * uma hora, em vez de exigir que alguém cace o número. `ATRADIUS_*_POLICY_ID` continua
 * existindo como OVERRIDE, para o caso de a credencial alcançar mais de uma apólice vigente.
 *
 * ── SANDBOX OU PRODUÇÃO ──────────────────────────────────────────────────────────
 * Quem decide é a setting `ambiente` de `credito_config` (/credito/config), lida a cada
 * chamada por `lerAmbienteSeguradora()`. O ambiente carrega TUDO junto — URL, client
 * id/secret, application key e apólice — e nada vaza de um para o outro: não existe
 * fallback de sandbox para produção, porque um teste caindo calado nas credenciais reais
 * é exatamente o acidente que este desenho existe para impedir.
 */

/**
 * TODAS confirmadas contra a API real (22/08/2026), em três domínios: `policy-management`,
 * `organisation-management` e `cover-management`.
 *
 * O que NÃO está confirmado deixou de ser caminho de rota e passou a ser vocabulário —
 * `decisionCode`, `historicCode` e a lista de `coverStatus`. Ver `mapearEstagio`.
 */
const ROTAS = {
  token: '/oauth2/token',
  apolices: '/credit-insurance/policy-management/v1/policies/details',
  buyerPorIdentificador: (pais: string, uid: string, tipo: string) =>
    `/credit-insurance/organisation-management/v1/buyers?country=${encodeURIComponent(pais)}` +
    `&uid=${encodeURIComponent(uid)}&uidType=${encodeURIComponent(tipo)}`,
  buyer: (buyerId: string) =>
    `/credit-insurance/organisation-management/v1/buyers/${encodeURIComponent(buyerId)}`,
  /**
   * Os buyers da apólice. É um endpoint de SAÚDE (rating), não de cobertura: aceita
   * `healthChange=up|down` e filtros por data de atualização do rating. Usamos sem filtro,
   * como listagem — mas é daqui que sairia um alerta de rebaixamento, no dia em que
   * quisermos um.
   *
   * `policyId` OU `customerId` bastam; mandamos os dois quando há organização configurada,
   * porque o par é mais específico que qualquer um sozinho.
   */
  meusBuyers: (q: string) => `/credit-insurance/organisation-management/v1/buyers/my-buyers?${q}`,
  /** POST cria a aplicação de cobertura. PUT com `action: supersede` altera uma existente. */
  cobertura: '/credit-insurance/cover-management/v1/covers',
  /** Coberturas vigentes da apólice — o portfólio. */
  coberturas: (q: string) => `/credit-insurance/cover-management/v1/covers?${q}`,
  /** Coberturas já decididas. */
  decisoes: (q: string) => `/credit-insurance/cover-management/v1/covers/decisions?${q}`,
  /** Aplicações ainda SEM decisão — é o que distingue "em análise" de "não existe". */
  aplicacoes: (q: string) => `/credit-insurance/cover-management/v1/covers/applications?${q}`,
}

/** CONFIRMADO: `Atradius-App-Key`, e não o `x-application-key` que eu tinha suposto. */
const CABECALHO_APP_KEY = 'Atradius-App-Key'

/**
 * Id de correlação, um por requisição. A Atradius o aceita em toda chamada e o usa para
 * rastrear a requisição do lado dela — por isso ele também vai para o nosso log de erro:
 * sem esse número, abrir um chamado sobre "uma consulta que falhou ontem" é descrever o
 * problema em vez de apontá-lo.
 */
const CABECALHO_CORRELACAO = 'Atradius-Correlation-Id'

interface Credenciais {
  ambiente: AmbienteSeguradora
  base_url: string
  client_id: string
  client_secret: string
  app_key: string
  /**
   * OVERRIDE opcional da apólice. Vazio — o caso normal — significa "pergunte à API qual
   * é": a apólice não aparece no portal de desenvolvedores, e obrigar alguém a caçar um
   * número que a própria API sabe informar é transformar configuração em arqueologia.
   *
   * Preencher só faz sentido quando a credencial alcança MAIS DE UMA apólice vigente e
   * é preciso fixar qual delas recebe os pedidos.
   */
  policy_id_override: string | null
}

interface TokenCache {
  valor: string
  expiraEm: number
  /**
   * O ambiente que emitiu o token. Sem isto, alternar de homologação para produção
   * continuaria mandando o token da sandbox para a URL de produção por até uma hora — e
   * o 401 resultante pareceria credencial errada, não cache velho.
   */
  ambiente: AmbienteSeguradora
}
let token: TokenCache | null = null

/**
 * Resolve o conjunto de credenciais do ambiente vigente, ou diz QUAL variável falta.
 *
 * O nome da variável ausente é devolvido de propósito: "credencial ausente" sozinho manda
 * quem está configurando conferir oito variáveis uma a uma.
 */
async function credenciais(): Promise<ResultadoSeguradora<Credenciais>> {
  const { ambiente } = await lerIntegracaoSeguradora()
  const prefixo = ambiente === 'producao' ? 'ATRADIUS_PROD' : 'ATRADIUS_SANDBOX'
  const bruto =
    ambiente === 'producao'
      ? {
          client_id: env.ATRADIUS_PROD_CLIENT_ID,
          client_secret: env.ATRADIUS_PROD_CLIENT_SECRET,
          app_key: env.ATRADIUS_PROD_APP_KEY,
          policy_id: env.ATRADIUS_PROD_POLICY_ID,
        }
      : {
          client_id: env.ATRADIUS_SANDBOX_CLIENT_ID,
          client_secret: env.ATRADIUS_SANDBOX_CLIENT_SECRET,
          app_key: env.ATRADIUS_SANDBOX_APP_KEY,
          policy_id: env.ATRADIUS_SANDBOX_POLICY_ID,
        }

  // `policy_id` ficou FORA desta lista: ele é override, e exigi-lo travaria a integração
  // inteira por um número que a API descobre sozinha.
  for (const campo of ['client_id', 'client_secret', 'app_key'] as const) {
    if (!bruto[campo]) {
      return {
        ok: false,
        erro: `Credencial ausente: ${prefixo}_${campo.toUpperCase()} (ambiente ${ambiente}).`,
        recuperavel: false,
      }
    }
  }

  return {
    ok: true,
    dados: {
      ambiente,
      base_url: AMBIENTES_SEGURADORA[ambiente].base_url,
      client_id: bruto.client_id as string,
      client_secret: bruto.client_secret as string,
      app_key: bruto.app_key as string,
      policy_id_override: bruto.policy_id ?? null,
    },
  }
}

function url(cred: Credenciais, rota: string): string {
  return new URL(rota, cred.base_url).toString()
}

/**
 * O filtro que todo endpoint de cobertura aceita. `policyId` sozinho basta; o `customerId`
 * entra quando configurado porque o par é mais específico — e porque é ele que a API usa
 * para escopar quando a credencial alcança mais de um cliente.
 */
function filtroDaApolice(policyId: string, organizacao: string | null): string {
  const qs = new URLSearchParams({ policyId })
  if (organizacao) qs.set('customerId', organizacao)
  return qs.toString()
}

/**
 * OAuth2 client-credentials, com o token guardado até 60s antes de vencer. A margem
 * existe porque um token que vence NO MEIO de uma paginação do backfill derruba a
 * corrida inteira em vez de uma página.
 */
async function obterToken(cred: Credenciais): Promise<ResultadoSeguradora<string>> {
  if (token && token.ambiente === cred.ambiente && token.expiraEm > Date.now() + 60_000) {
    return { ok: true, dados: token.valor }
  }

  try {
    const corpo = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cred.client_id,
      client_secret: cred.client_secret,
    })
    // `fetch` cru, e não `requisitarJson`: o token é form-urlencoded e aquele helper
    // faz JSON.stringify no body, o que transformaria `a=b` na string `"a=b"`.
    const res = await fetch(url(cred, ROTAS.token), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        [CABECALHO_APP_KEY]: cred.app_key,
        [CABECALHO_CORRELACAO]: crypto.randomUUID(),
      },
      body: corpo.toString(),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      return { ok: false, erro: `A Atradius recusou a autenticação (${res.status}).`, recuperavel: res.status >= 500 }
    }
    const resp = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!resp.access_token) return { ok: false, erro: 'A Atradius não devolveu access_token.', recuperavel: true }
    token = {
      valor: resp.access_token,
      expiraEm: Date.now() + (resp.expires_in ?? 3600) * 1000,
      ambiente: cred.ambiente,
    }
    // O ambiente no log é o que responde "por que este número veio diferente do que a
    // tela mostrava?" sem precisar reproduzir a corrida.
    logger.info({ ambiente: cred.ambiente }, 'Token da Atradius renovado.')
    return { ok: true, dados: token.valor }
  } catch (e) {
    // Nunca ecoar o erro cru: numa URL malformada ele carrega host e às vezes a query.
    logger.error({ erro: e instanceof Error ? e.name : 'desconhecido' }, 'Falha ao autenticar na Atradius.')
    return { ok: false, erro: 'Não foi possível autenticar na Atradius.', recuperavel: true }
  }
}

async function chamar<T>(
  caminho: string,
  opcoes: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<ResultadoSeguradora<T>> {
  const c = await credenciais()
  if (!c.ok) return c
  const cred = c.dados

  const t = await obterToken(cred)
  if (!t.ok) return t

  // Gerado aqui, e não dentro do helper HTTP, para que as duas tentativas de uma mesma
  // chamada compartilhem o id: é a chamada que se rastreia, não o pacote.
  const correlacao = crypto.randomUUID()

  try {
    const dados = await requisitarJson<T>(url(cred, caminho), {
      method: opcoes.method ?? 'GET',
      headers: {
        authorization: `Bearer ${t.dados}`,
        [CABECALHO_APP_KEY]: cred.app_key,
        [CABECALHO_CORRELACAO]: correlacao,
        accept: 'application/json',
        ...(opcoes.body ? { 'content-type': 'application/json' } : {}),
      },
      // Objeto, não string: `requisitarJson` já faz o JSON.stringify.
      ...(opcoes.body ? { body: opcoes.body } : {}),
      timeoutMs: 30_000,
      tentativas: 2,
    })
    return { ok: true, dados }
  } catch (e) {
    const msg = String(e)
    // 4xx é resposta, não falha de transporte: retentar só gasta chamada.
    const recuperavel = !/\b4\d\d\b/.test(msg)
    logger.error(
      { rota: caminho, ambiente: cred.ambiente, correlacao, recuperavel },
      'Chamada à Atradius falhou.',
    )
    return { ok: false, erro: `Atradius respondeu com erro${recuperavel ? ' temporário' : ''}.`, recuperavel }
  }
}

// ─── A apólice, descoberta em vez de configurada ────────────────────────────

/**
 * CONFIRMADO contra a resposta real de `policies/details` (22/08/2026): o corpo vem
 * embrulhado em `data`, com `policyId`, `policyStatus`, `policyStartDate`,
 * `policyExpiryDate` e `policyCurrency`. Os demais nomes seguem como alternativas
 * defensivas — custam nada e cobrem uma variação de versão.
 */
interface ApoliceBruta {
  policyId?: string
  policyNumber?: string
  id?: string
  number?: string
  name?: string
  description?: string
  status?: string
  policyStatus?: string
  state?: string
  policyCurrency?: string
  currency?: string
  policyStartDate?: string
  validFrom?: string
  startDate?: string
  inceptionDate?: string
  policyExpiryDate?: string
  validUntil?: string
  endDate?: string
  expiryDate?: string
}

interface Apolice {
  policy_id: string
  descricao: string
  /** A moeda DA APÓLICE. Ver o aviso em `pedirCobertura`: ela pode não ser a nossa. */
  moeda: string | null
}

const MORTA = /cancel|terminat|lapse|expir|void|ceased|encerrad|cancelad/i
// `live` está aqui porque a API DEVOLVEU `policyStatus: "live"` — e nenhum dos termos que
// eu tinha imaginado ("active", "in force") batia. É o lembrete de que este vocabulário se
// confirma contra resposta real, nunca contra intuição: o mesmo vale para `mapearEstagio`.
const VIVA = /activ|in.?force|current|running|vigent|valid|live/i

/**
 * Uma apólice está vigente se o STATUS diz que sim — e, quando não há status, se hoje cai
 * dentro das datas. As duas leituras existem porque nomes de campo não estão confirmados:
 * o handbook pode devolver `status`, `policyStatus` ou só o par de datas.
 *
 * Status que fala em cancelamento/expiração vence tudo, inclusive datas que ainda cobrem
 * hoje. Uma apólice cancelada com validade nominal em aberto não recebe pedido.
 */
function estaVigente(a: ApoliceBruta): boolean {
  const status = a.status ?? a.policyStatus ?? a.state ?? ''
  if (MORTA.test(status)) return false
  if (VIVA.test(status)) return true

  const inicio = a.policyStartDate ?? a.validFrom ?? a.startDate ?? a.inceptionDate
  const fim = a.policyExpiryDate ?? a.validUntil ?? a.endDate ?? a.expiryDate
  if (!inicio && !fim) return status === '' // sem status e sem datas: não dá para excluir
  const hoje = new Date().toISOString().slice(0, 10)
  if (inicio && inicio.slice(0, 10) > hoje) return false
  if (fim && fim.slice(0, 10) < hoje) return false
  return true
}

function mapearApolice(a: ApoliceBruta): Apolice | null {
  const id = a.policyId ?? a.policyNumber ?? a.id ?? a.number
  if (!id) return null
  const status = a.policyStatus ?? a.status ?? a.state ?? 'sem status'
  const fim = a.policyExpiryDate ?? a.validUntil ?? a.endDate ?? a.expiryDate
  const moeda = a.policyCurrency ?? a.currency ?? null
  return {
    policy_id: String(id),
    descricao: `${id} (${status}${moeda ? `, ${moeda}` : ''}${fim ? `, até ${fim.slice(0, 10)}` : ''})`,
    moeda,
  }
}

interface ApoliceCache {
  apolice: Apolice
  ambiente: AmbienteSeguradora
  lidaEm: number
}
/**
 * Uma hora. A apólice muda quando um contrato é renovado — coisa de uma vez por ano — e
 * uma consulta por chamada colocaria uma ida à rede na frente de cada página do backfill.
 * Uma hora também é o teto de quanto tempo o worker segue usando um contrato que acabou
 * de ser substituído, o que é aceitável para algo que se renova anualmente.
 */
const APOLICE_TTL_MS = 60 * 60 * 1000
let apoliceCache: ApoliceCache | null = null

/**
 * `policies/details` devolve UM objeto embrulhado em `data` — não uma lista, e não a
 * página com `items`/`content` que os outros recursos usam. A versão anterior tratava
 * `data` como array e teria estourado na primeira execução contra a API real.
 *
 * Por isso a extração aceita as duas formas em cada chave: array vira a lista, objeto
 * vira lista de um. É o que permite a mesma função servir a este endpoint e a um
 * eventual `/policies` que devolva várias.
 */
function extrairApolices(corpo: unknown): ApoliceBruta[] {
  if (Array.isArray(corpo)) return corpo as ApoliceBruta[]
  if (!corpo || typeof corpo !== 'object') return []
  const o = corpo as Record<string, unknown>
  for (const chave of ['data', 'items', 'content', 'policies', 'results']) {
    const v = o[chave]
    if (Array.isArray(v)) return v as ApoliceBruta[]
    if (v && typeof v === 'object') return [v as ApoliceBruta]
  }
  // Sem envelope reconhecido: o próprio corpo é a apólice.
  return [o as ApoliceBruta]
}

/**
 * Descobre a apólice sob a qual esta credencial opera.
 *
 * ── POR QUE FALHA EM VEZ DE ESCOLHER, QUANDO HÁ MAIS DE UMA ──────────────────
 * Pegar "a primeira" de duas apólices vigentes é o tipo de default que funciona por um
 * ano e um dia. Pedido submetido contra o contrato errado não dá erro: dá um limite
 * aprovado sob uma cobertura que não é a que a operação assume — e ninguém descobre
 * isso até um sinistro. Então: uma vigente, usa; nenhuma ou várias, para e diz o que
 * viu, nomeando a variável que resolve.
 */
async function apoliceVigente(): Promise<ResultadoSeguradora<Apolice>> {
  const c = await credenciais()
  if (!c.ok) return c
  const cred = c.dados

  if (cred.policy_id_override) {
    return {
      ok: true,
      dados: {
        policy_id: cred.policy_id_override,
        descricao: `${cred.policy_id_override} (fixada por env)`,
        // Fixada à mão, não sabemos a moeda dela — e inventar uma apagaria o aviso de
        // divergência em `pedirCobertura`, que é justamente onde ele importa.
        moeda: null,
      },
    }
  }

  if (
    apoliceCache &&
    apoliceCache.ambiente === cred.ambiente &&
    Date.now() - apoliceCache.lidaEm < APOLICE_TTL_MS
  ) {
    return { ok: true, dados: apoliceCache.apolice }
  }

  const r = await chamar<unknown>(ROTAS.apolices)
  if (!r.ok) return r

  const lista = extrairApolices(r.dados)
  const vigentes = lista.filter(estaVigente).map(mapearApolice).filter((a): a is Apolice => a !== null)
  const prefixo = cred.ambiente === 'producao' ? 'ATRADIUS_PROD' : 'ATRADIUS_SANDBOX'

  if (vigentes.length === 0) {
    return {
      ok: false,
      erro:
        `Nenhuma apólice vigente em ${cred.ambiente} (${lista.length} devolvida(s) pela API). ` +
        `Se a apólice existe e a leitura é que não a reconheceu, fixe ${prefixo}_POLICY_ID.`,
      // Não é falha de transporte: retentar devolve a mesma lista.
      recuperavel: false,
    }
  }

  if (vigentes.length > 1) {
    return {
      ok: false,
      erro:
        `${vigentes.length} apólices vigentes em ${cred.ambiente} (${vigentes
          .map((a) => a.policy_id)
          .join(', ')}). Escolher sozinho seria decidir sob qual contrato a cobertura é ` +
        `pedida — defina ${prefixo}_POLICY_ID.`,
      recuperavel: false,
    }
  }

  const apolice = vigentes[0] as Apolice
  apoliceCache = { apolice, ambiente: cred.ambiente, lidaEm: Date.now() }
  logger.info({ ambiente: cred.ambiente, apolice: apolice.descricao }, 'Apólice da Atradius resolvida.')
  return { ok: true, dados: apolice }
}

/** Apólice + organização resolvidas na query que todo endpoint de cobertura aceita. */
async function filtroAtual(): Promise<ResultadoSeguradora<string>> {
  const a = await apoliceVigente()
  if (!a.ok) return a
  const { organizacao_id } = await lerIntegracaoSeguradora()
  return { ok: true, dados: filtroDaApolice(a.dados.policy_id, organizacao_id) }
}

// ─── Mapeamento (a superfície que muda quando o handbook chegar) ────────────

/**
 * CONFIRMADO contra a API real (22/08/2026). Quase nada do que eu tinha suposto sobreviveu:
 * o id é NÚMERO (`buyerId: 11223344`), o rating é `currentBuyerRating` (não `rating`), e o
 * identificador nacional não é um campo — vem dentro de `uniqueIdentifiers[]`.
 *
 * O NOME não aparece em nenhum dos três exemplos. Ou está num campo que os exemplos
 * omitem, ou mora dentro de `registeredAddress`. Enquanto não se confirmar, `nome` fica
 * null — e isso é seguro, porque a esteira nunca casa buyer por nome, só por CNPJ.
 */
interface BuyerBruto {
  buyerId?: string | number
  id?: string | number
  /** O CNPJ vive aqui. Formato dos itens ainda não confirmado — ver `cnpjDosIdentificadores`. */
  uniqueIdentifiers?: unknown[]
  name?: string
  organisationName?: string
  legalName?: string
  tradingName?: string
  currentBuyerRating?: string
  currentBuyerRatingClass?: string
  rating?: string
  buyerRating?: string
  tradingStatus?: string
  tradingStatusCode?: string
}

/**
 * Uma COBERTURA (`cover`), que é o que a Atradius chama do que aqui é "decisão".
 * CONFIRMADO contra as respostas reais de `/covers`, `/covers/decisions`,
 * `/covers/applications` e `/covers/historic`.
 *
 * ── DUAS MOEDAS, E POR QUE SÓ UMA VALE ───────────────────────────────────────
 * Todo valor vem duplicado: `...InPolicyCurrency` e `...InUserCurrency` (no exemplo, EUR e
 * DKK). Lemos SEMPRE a da apólice, porque é nela que a cobertura existe — a "user currency"
 * é conveniência de exibição de quem consultou, e misturar as duas produziria um limite
 * numericamente plausível e factualmente errado.
 *
 * ── O VALOR APLICADO NÃO É O VALOR APROVADO ──────────────────────────────────
 * `creditLimitApplicationAmount...` é o que PEDIMOS. O que a Atradius CONCEDEU está em
 * `totalDecision.decisionAmtInPolicyCurrency`. Usar o primeiro como fallback do segundo
 * seria registrar como aprovado um número que ninguém aprovou.
 */
interface DecisaoBruta {
  coverId?: string | number
  buyerId?: string | number
  buyerName?: string
  uniqueIdentifiers?: unknown[]
  coverStatus?: string
  decisionCode?: string
  decisionTypeDescription?: string
  historicCode?: string
  pendingProcessStatus?: string
  pendingProcessIndicator?: string
  policyCurrencyCode?: string
  creditLimitApplicationAmountInPolicyCurrency?: string | number
  totalDecision?: DecisaoValor
  firstAmtDecision?: DecisaoValor
  applicationDate?: string
  decisionDate?: string
  effectFromDate?: string
  withdrawalDate?: string
  effectiveToDate?: string
  currentBuyerRating?: string
  notes?: string
}

interface DecisaoValor {
  decisionAmtInPolicyCurrency?: string | number
  decisionConditions?: Array<{
    conditionDescription?: string
    conditionCategoryDescription?: string
    conditionCode?: string
    conditionType?: string
  }>
}

function soDigitos(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length === 14 ? d : null
}

/**
 * Acha o CNPJ dentro de `uniqueIdentifiers[]`, cujo formato o retorno do PATCH confirmou:
 * `[{ uid, uidType, uidTypeDescription }]`.
 *
 * Lê `uid` quando existe, mas ainda VALIDA por 14 dígitos em vez de confiar no `uidType` —
 * porque qual `uidType` o Brasil usa é justamente o que não sabemos (o enum não tem CNPJ).
 * Aceitar pelo tipo declarado nos faria gravar um VAT europeu como se fosse CNPJ no dia em
 * que um buyer estrangeiro entrasse na apólice; validar pelo formato não tem esse risco.
 *
 * O varrer-todos-os-valores continua como último recurso, para o caso de a chave mudar de
 * nome entre versões.
 */
function cnpjDosIdentificadores(itens: unknown[] | undefined): string | null {
  for (const item of itens ?? []) {
    if (typeof item === 'string') {
      const d = soDigitos(item)
      if (d) return d
      continue
    }
    if (!item || typeof item !== 'object') continue
    const uid = (item as { uid?: unknown }).uid
    if (typeof uid === 'string' || typeof uid === 'number') {
      const d = soDigitos(String(uid))
      if (d) return d
    }
    for (const v of Object.values(item as Record<string, unknown>)) {
      if (typeof v !== 'string' && typeof v !== 'number') continue
      const d = soDigitos(String(v))
      if (d) return d
    }
  }
  return null
}

/**
 * Os três endpoints de buyer devolvem `{ "data": [ ... ] }` — array SEMPRE, mesmo o de id
 * único, que devolve um array de um. Aceitar as duas formas custa duas linhas e evita que
 * uma mudança de envelope vire um null silencioso.
 */
function extrairBuyers(corpo: unknown): BuyerBruto[] {
  if (Array.isArray(corpo)) return corpo as BuyerBruto[]
  if (!corpo || typeof corpo !== 'object') return []
  const d = (corpo as { data?: unknown }).data
  if (Array.isArray(d)) return d as BuyerBruto[]
  if (d && typeof d === 'object') return [d as BuyerBruto]
  return [corpo as BuyerBruto]
}

function mapearBuyer(b: BuyerBruto | null | undefined): BuyerSeguradora | null {
  if (!b) return null
  const id = b.buyerId ?? b.id
  // `?? null` e não `!id`: buyerId é número, e um id 0 hipotético não pode virar "ausente".
  if (id === undefined || id === null || id === '') return null
  return {
    buyer_id: String(id),
    // O identificador nacional é o elo com a nossa base. Sem os 14 dígitos ele vira
    // null e o backfill manda a linha para revisão manual — em vez de casar por nome,
    // que é como duas construtoras homônimas viram a mesma empresa.
    identificador_nacional: cnpjDosIdentificadores(b.uniqueIdentifiers),
    nome: b.name ?? b.organisationName ?? b.legalName ?? b.tradingName ?? null,
    rating: b.currentBuyerRating ?? b.rating ?? b.buyerRating ?? null,
  }
}

/**
 * `decisionCode` → estágio. CONFIRMADO no apêndice "Cover Codes".
 *
 * Três leituras que não são óbvias na tabela:
 *
 * **DC05** ("refusal for increase, current cover remains unchanged") é `negada` porque o
 * que foi recusado é o PEDIDO — que é o que a esteira acompanha. A cobertura anterior
 * seguir de pé não torna o pedido aprovado.
 *
 * **DC06/DC07** são preliminares: uma decisão final vem depois. Marcá-los tira a análise
 * do poll, mas não da história — o sync diário casa por `atradius_case_id` em qualquer
 * estágio e recolhe a final dentro da janela de 30 dias.
 *
 * **DC21** ("pre-notification of withdrawal") NÃO é cancelamento: a cobertura vale hoje.
 * Ele vira `pendencia`, que é onde esse aviso pode ser visto sem mentir sobre o estágio.
 */
const DECISAO_PARA_ESTAGIO: Record<string, EstagioSeguradora> = {
  DC01: 'aprovada', // Fully approved
  DC02: 'aprovada', // Approved with conditions and/or comments
  DC03: 'negada', // Refused
  DC04: 'aprovada_parcial', // Partially approved — final
  DC05: 'negada', // Refusal for increase
  DC06: 'aprovada_parcial', // Partially approved — preliminary
  DC07: 'negada', // Preliminary refusal
  DC08: 'cancelada', // Withdrawal decided by Atradius
  DC09: 'aprovada', // Reduction in cover — o valor conta a história
  DC10: 'aprovada', // Revised terms of cover
  DC11: 'aprovada', // Reissue of limit
  DC21: 'aprovada', // Pre-notification of withdrawal — ver `pendencia`
  DC22: 'aprovada', // Reduction due to partial expiry
}

/**
 * `historicCode` → estágio, para os códigos que ENCERRAM a cobertura sem ambiguidade.
 *
 * `ACLD` (amended), `ICLD` (re-issued) e `MCLD` (maintained) ficaram DE FORA de propósito:
 * eles encerram uma *versão* da cobertura, que segue existindo com outro conteúdo. Forçar
 * um estágio a partir deles esconderia o que a decisão nova diz — que é justamente o que
 * `decisionCode` e o valor concedido respondem melhor.
 */
const HISTORICO_PARA_ESTAGIO: Record<string, EstagioSeguradora> = {
  CCLA: 'cancelada', // Cancelled application
  RCLA: 'negada', // Rejected application
  SCLA: 'cancelada', // Superseded application
  TCLA: 'cancelada', // Transferred application
  ARCH: 'cancelada', // Archived
  CCLD: 'cancelada', // Cancelled decision
  CIND: 'cancelada', // Cancelled indication
  ECLD: 'expirada', // Expired decision
  PCLD: 'cancelada', // Cancelled by policy cancellation
  SCLD: 'cancelada', // Superseded decision
  TCLD: 'cancelada', // Transferred decision
  WCLD: 'cancelada', // Withdrawn decision
}

/** `pendingProcessIndicator` → texto, do apêndice "Batch Action Indicators". */
const PENDENCIAS: Record<string, string> = {
  B: 'Alteração de condições em lote pendente',
  C: 'Cancelamento pendente',
  F: 'Retirada futura agendada',
  P: 'Retirada futura adiada',
  R: 'Reativação pendente',
  T: 'Transferência pendente',
  V: 'Conversão de indicação pendente',
  W: 'Retirada pendente',
}

/** Números vêm como string ("50000") e às vezes como string VAZIA. */
function numeroOuNull(v: string | number | undefined | null): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * A parte de data de um timestamp da Atradius.
 *
 * O apêndice avisa que as respostas vêm em UTC **ou UTC+01:00 (BST)**. Cortar os dez
 * primeiros caracteres preserva a data como a seguradora a apresenta — que é a que aparece
 * no portal e a que alguém vai conferir. Converter para UTC antes recuaria um dia em
 * qualquer carimbo entre 00:00 e 01:00 BST, criando divergência com a tela deles.
 */
function dataDaAtradius(v: string | undefined | null): string | null {
  if (!v) return null
  const d = v.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

/**
 * A ação já agendada sobre a cobertura, se houver. Ela NÃO muda o estágio: uma cobertura
 * com cancelamento pendente ainda vale hoje.
 *
 * Esta distinção era um bug até o apêndice chegar — `pendingProcessStatus: "Pending
 * Cancellation"` casava com a busca por "cancel" e derrubava para `cancelada` uma cobertura
 * que seguia de pé, zerando um limite que a operação ainda podia usar.
 */
function pendenciaDaCobertura(d: DecisaoBruta): string | null {
  if (d.pendingProcessStatus?.trim()) return d.pendingProcessStatus.trim()
  const i = d.pendingProcessIndicator?.trim().toUpperCase()
  if (i && PENDENCIAS[i]) return PENDENCIAS[i] as string
  if (d.decisionCode === 'DC21') return 'Pré-aviso de retirada de cobertura'
  return null
}

/**
 * O vocabulário da seguradora → o nosso.
 *
 * A ordem é: código histórico (a cobertura acabou) → código de decisão → valor concedido.
 * Os dois primeiros vêm dos apêndices e são a leitura correta; o terceiro existe para
 * códigos que a Atradius acrescentar depois — melhor inferir pelo valor que travar o poll
 * de todas as outras análises num código desconhecido.
 */
function mapearEstagio(d: DecisaoBruta): EstagioSeguradora {
  const historico = HISTORICO_PARA_ESTAGIO[(d.historicCode ?? '').trim().toUpperCase()]
  if (historico) return historico

  const decisao = DECISAO_PARA_ESTAGIO[(d.decisionCode ?? '').trim().toUpperCase()]
  if (decisao) return decisao

  // Daqui para baixo é fallback para vocabulário novo. `pendingProcessStatus` NUNCA entra:
  // ele descreve o que vai acontecer, não o que aconteceu.
  const texto = [d.decisionTypeDescription, d.historicCode, d.coverStatus]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/cancel|withdraw/.test(texto)) return 'cancelada'
  if (/expir|lapse/.test(texto)) return 'expirada'

  const fim = dataDaAtradius(d.withdrawalDate ?? d.effectiveToDate)
  if (fim && fim < new Date().toISOString().slice(0, 10)) return 'expirada'

  const concedido = numeroOuNull(d.totalDecision?.decisionAmtInPolicyCurrency)
  const pedido = numeroOuNull(d.creditLimitApplicationAmountInPolicyCurrency)
  if (concedido !== null) {
    if (concedido <= 0) return 'negada'
    if (pedido !== null && concedido < pedido) return 'aprovada_parcial'
    return 'aprovada'
  }

  if (/refus|declin|reject|denied/.test(texto)) return 'negada'
  return 'em_analise'
}

/**
 * O motivo, montado das `decisionConditions` — que é onde a Atradius explica a decisão em
 * texto corrido ("Our decision is based on the latest accounts…"). É o campo que o analista
 * lê antes de discordar do número, então vale mais que o código da condição.
 */
function motivoDaDecisao(d: DecisaoBruta): string | null {
  const condicoes = [
    ...(d.totalDecision?.decisionConditions ?? []),
    ...(d.firstAmtDecision?.decisionConditions ?? []),
  ]
  const textos = condicoes
    // A categoria entra quando não há texto: "Suspeita de fraude" sem descrição ainda é
    // muito mais informação para o analista que um motivo em branco.
    .map((c) => c.conditionDescription?.trim() || c.conditionCategoryDescription?.trim())
    .filter((t): t is string => !!t)
  // `Set` porque as três decisões (total, primeira, segunda) repetem a mesma condição no
  // exemplo real — e um motivo triplicado na tela parece três problemas diferentes.
  const unicos = [...new Set(textos)]
  const base = unicos.length ? unicos.join(' | ') : (d.notes?.trim() || null)

  // A pendência entra no motivo porque é a única superfície que a tela já mostra. Uma
  // retirada agendada que só aparece no log é um aviso que ninguém recebe.
  const pendencia = pendenciaDaCobertura(d)
  if (!pendencia) return base
  return base ? `${pendencia}. ${base}` : pendencia
}

function mapearDecisao(d: DecisaoBruta | null | undefined): DecisaoSeguradora | null {
  if (!d) return null
  const caseId = d.coverId
  if (caseId === undefined || caseId === null || caseId === '') return null
  if (d.buyerId === undefined || d.buyerId === null || d.buyerId === '') return null
  return {
    case_id: String(caseId),
    buyer_id: String(d.buyerId),
    estagio: mapearEstagio(d),
    // Só o valor CONCEDIDO. O aplicado nunca entra aqui — ver o comentário de DecisaoBruta.
    limite_aprovado: numeroOuNull(d.totalDecision?.decisionAmtInPolicyCurrency),
    // A moeda da APÓLICE, não a de exibição de quem consultou.
    moeda: d.policyCurrencyCode ?? 'BRL',
    // A Atradius não devolve "válido até" numa cobertura viva: a cobertura vale até ser
    // cancelada. `withdrawalDate`/`effectiveToDate` só aparecem quando ela já acabou — daí
    // a validade padrão da nossa config continuar sendo o que preenche esse campo.
    expira_em: dataDaAtradius(d.withdrawalDate ?? d.effectiveToDate),
    decidida_em: d.decisionDate ?? null,
    motivo: motivoDaDecisao(d),
    rating: d.currentBuyerRating ?? null,
    // A própria cobertura carrega o buyer: o backfill deixa de precisar detalhar um a um.
    identificador_nacional: cnpjDosIdentificadores(d.uniqueIdentifiers),
    nome_buyer: d.buyerName ?? null,
    pendencia: pendenciaDaCobertura(d),
  }
}

/**
 * Extrai a lista de coberturas de qualquer um dos endpoints de `cover-management`. Eles
 * variam: uns devolvem `{data: [...]}`, o PATCH devolve `{data: {...}}` e um dos exemplos
 * veio como array cru.
 *
 * ── PAGINAÇÃO ────────────────────────────────────────────────────────────────
 * Nenhum dos endpoints de cobertura documenta cursor, página ou offset. Por isso
 * `proximoCursor` é sempre null: inventar um parâmetro faria a API ignorá-lo em silêncio, e
 * o backfill acharia que leu tudo quando leu a primeira página. Se a apólice crescer e a
 * lista vier truncada, isso aparece como decisão que não chega — e o conserto é acrescentar
 * o parâmetro real aqui.
 */
function extrairCoberturas(corpo: unknown): DecisaoBruta[] {
  if (Array.isArray(corpo)) return corpo as DecisaoBruta[]
  if (!corpo || typeof corpo !== 'object') return []
  const d = (corpo as { data?: unknown }).data
  if (Array.isArray(d)) return d as DecisaoBruta[]
  if (d && typeof d === 'object') return [d as DecisaoBruta]
  return [corpo as DecisaoBruta]
}

function mapearPagina(corpo: unknown): {
  itens: DecisaoSeguradora[]
  proximoCursor: string | null
} {
  return {
    itens: extrairCoberturas(corpo)
      .map(mapearDecisao)
      .filter((d): d is DecisaoSeguradora => d !== null),
    proximoCursor: null,
  }
}

/**
 * O estado de TODAS as coberturas da apólice, indexado por `coverId`.
 *
 * ── POR QUE UM MAPA, E NÃO UMA CONSULTA POR CASO ─────────────────────────────
 * A API de cobertura não expõe `GET /covers/{coverId}`: o que existe são listagens por
 * apólice. Consultar caso a caso significaria baixar a lista inteira uma vez por análise
 * aberta — com trinta análises no poll, trinta downloads do mesmo conteúdo.
 *
 * ── POR QUE DUAS CHAMADAS ────────────────────────────────────────────────────
 * `/covers/decisions` traz o que já foi decidido; `/covers/applications` traz o que ainda
 * não foi. Sem a segunda, uma análise pendente ficaria indistinguível de uma que sumiu da
 * apólice — e "sumiu" é o que a esteira precisa tratar diferente de "ainda esperando".
 *
 * O cache de dois minutos existe para o poll: ele é uma rodada só, e dentro dela o estado
 * não muda. Entre rodadas, expira.
 */
const COBERTURAS_TTL_MS = 2 * 60 * 1000
let coberturasCache: {
  mapa: Map<string, DecisaoSeguradora>
  ambiente: AmbienteSeguradora
  lidoEm: number
} | null = null

async function mapaDeCoberturas(): Promise<ResultadoSeguradora<Map<string, DecisaoSeguradora>>> {
  const c = await credenciais()
  if (!c.ok) return c

  if (
    coberturasCache &&
    coberturasCache.ambiente === c.dados.ambiente &&
    Date.now() - coberturasCache.lidoEm < COBERTURAS_TTL_MS
  ) {
    return { ok: true, dados: coberturasCache.mapa }
  }

  const f = await filtroAtual()
  if (!f.ok) return f

  const decisoes = await chamar<unknown>(ROTAS.decisoes(f.dados))
  if (!decisoes.ok) return decisoes
  const aplicacoes = await chamar<unknown>(ROTAS.aplicacoes(f.dados))

  const mapa = new Map<string, DecisaoSeguradora>()
  // Aplicações primeiro, decisões por cima: quando as duas listas trazem o mesmo cover, a
  // decisão é a informação mais nova. A ordem inversa mostraria "em análise" para algo que
  // já foi decidido — e o poll marcaria a análise como pendente para sempre.
  if (aplicacoes.ok) {
    for (const d of mapearPagina(aplicacoes.dados).itens) mapa.set(d.case_id, d)
  } else {
    logger.warn({ erro: aplicacoes.erro }, 'Aplicações pendentes indisponíveis; só decisões.')
  }
  for (const d of mapearPagina(decisoes.dados).itens) mapa.set(d.case_id, d)

  coberturasCache = { mapa, ambiente: c.dados.ambiente, lidoEm: Date.now() }
  return { ok: true, dados: mapa }
}

// ─── O provedor ─────────────────────────────────────────────────────────────

export const atradius: Seguradora = {
  id: 'atradius',
  nome: 'Atradius',

  async configurada() {
    const c = await credenciais()
    // O motivo é logado AQUI, e não no chamador: o job só sabe "não configurada", e a
    // pessoa que abrir o log precisa do nome da variável e do ambiente em que ela falta.
    if (!c.ok) {
      logger.warn({ erro: c.erro }, 'Seguradora não configurada.')
      return false
    }

    // O Organization ID entra no gate embora as LEITURAS funcionem sem ele (`policyId`
    // sozinho basta nos GETs). O motivo é o envio: `customerId` é obrigatório no corpo do
    // POST, e `resolverBuyer` — que pode ser cobrado — roda antes dele. Sem este gate,
    // faltar o Organization ID sairia caro em vez de sair claro.
    const { organizacao_id } = await lerIntegracaoSeguradora()
    if (!organizacao_id) {
      logger.warn(
        'Organization ID não configurado (Crédito → Configurações → Identificação na seguradora).',
      )
      return false
    }
    return true
  },

  async resolverBuyer(cnpj) {
    const digitos = soDigitos(cnpj)
    // Barra antes de sair: esta é a chamada que pode ser cobrada, e um CNPJ malformado
    // gastaria a consulta para receber "não encontrado".
    if (!digitos) {
      return { ok: false, erro: `CNPJ inválido para consulta: ${cnpj}.`, recuperavel: false }
    }
    const { uid_type } = await lerIntegracaoSeguradora()
    const r = await chamar<unknown>(
      ROTAS.buyerPorIdentificador(PAIS_SEGURADORA_BR, digitos, uid_type),
    )
    if (!r.ok) return r
    // `data` é ARRAY nos três endpoints de buyer — inclusive no de id único.
    return { ok: true, dados: mapearBuyer(extrairBuyers(r.dados)[0]) }
  },

  async detalharBuyer(buyerId) {
    const r = await chamar<unknown>(ROTAS.buyer(buyerId))
    if (!r.ok) return r
    return { ok: true, dados: mapearBuyer(extrairBuyers(r.dados)[0]) }
  },

  async listarBuyersDaApolice() {
    const f = await filtroAtual()
    if (!f.ok) return f
    const r = await chamar<unknown>(ROTAS.meusBuyers(f.dados))
    if (!r.ok) return r
    const buyers = extrairBuyers(r.dados)
      .map(mapearBuyer)
      .filter((b): b is BuyerSeguradora => b !== null)
    // Lista vazia é resposta legítima (apólice sem buyer ainda) e vira `[]`. `null` fica
    // reservado para "a listagem não serve", que é o que faz o backfill cair no plano B.
    return { ok: true, dados: buyers }
  },

  apoliceVigente,

  async pedirCobertura(pedido: PedidoCobertura) {
    const a = await apoliceVigente()
    if (!a.ok) return a
    const { organizacao_id } = await lerIntegracaoSeguradora()
    // `customerId` é OBRIGATÓRIO no corpo do POST — diferente dos GETs, onde a apólice
    // sozinha basta. Sem ele o pedido não sai, e falhar aqui com o nome do campo é melhor
    // que um 400 traduzido para "Atradius respondeu com erro".
    if (!organizacao_id) {
      return {
        ok: false,
        erro: 'Organization ID não configurado (Crédito → Configurações → Identificação na seguradora).',
        recuperavel: false,
      }
    }

    // A apólice do exemplo real é em EUR e os nossos limites são em BRL. Pedir cobertura
    // numa moeda que a apólice não opera não costuma dar erro: costuma dar um número
    // aceito e interpretado na moeda dela — 5.000.000 vira cinco milhões de euros. O
    // aviso fica no log em vez de bloquear porque quem decide como converter é o negócio,
    // não este arquivo.
    if (a.dados.moeda && a.dados.moeda !== pedido.moeda) {
      logger.warn(
        { apolice: a.dados.policy_id, moeda_apolice: a.dados.moeda, moeda_pedido: pedido.moeda },
        'Moeda do pedido diverge da moeda da apólice.',
      )
    }

    const r = await chamar<unknown>(ROTAS.cobertura, {
      method: 'POST',
      body: {
        customerId: Number(organizacao_id),
        policyId: a.dados.policy_id,
        buyerId: Number(pedido.buyer_id),
        coverType: 'credit-limit',
        currencyCode: pedido.moeda,
        creditLimitAmount: pedido.limite_solicitado,
        // Hoje: a cobertura vale a partir de hoje. Data futura é um recurso da API que a
        // esteira não usa — quem pede limite aqui quer operar agora.
        effectFromDate: new Date().toISOString().slice(0, 10),
        // A NOSSA referência. É por ela que a decisão volta a encontrar a linha da esteira
        // quando o coverId se perde.
        customerRefNumber: pedido.referencia_externa,
      },
    })
    if (!r.ok) return r
    // Resposta: `{ data: [{ coverId, response: "Action successful" }] }`.
    const primeiro = extrairCoberturas(r.dados)[0]
    const coverId = primeiro?.coverId
    if (coverId === undefined || coverId === null || coverId === '') {
      return { ok: false, erro: 'A Atradius aceitou o pedido mas não devolveu um coverId.', recuperavel: false }
    }
    return { ok: true, dados: { case_id: String(coverId) } }
  },

  async consultarDecisao(caseId) {
    const mapa = await mapaDeCoberturas()
    if (!mapa.ok) return mapa
    // `null` aqui significa "esta apólice não conhece este cover" — que a esteira já trata
    // deixando a análise onde está, em vez de inventar um estágio.
    return { ok: true, dados: mapa.dados.get(String(caseId)) ?? null }
  },

  async listarPortfolio() {
    const f = await filtroAtual()
    if (!f.ok) return f
    const r = await chamar<unknown>(ROTAS.coberturas(f.dados))
    if (!r.ok) return r
    return { ok: true, dados: mapearPagina(r.dados) }
  },

  async listarDecisoes(desde) {
    const f = await filtroAtual()
    if (!f.ok) return f
    const r = await chamar<unknown>(ROTAS.decisoes(f.dados))
    if (!r.ok) return r
    const pagina = mapearPagina(r.dados)
    // O filtro por data é NOSSO: o endpoint de decisões não documenta parâmetro de janela,
    // e mandar um inventado seria ignorado em silêncio — o sync acharia que filtrou.
    // Filtrar aqui custa tráfego e devolve o recorte certo; um `since` fantasma devolveria
    // o recorte errado sem avisar.
    if (!desde) return { ok: true, dados: pagina }
    return {
      ok: true,
      dados: {
        ...pagina,
        itens: pagina.itens.filter((d) => !d.decidida_em || d.decidida_em.slice(0, 10) >= desde),
      },
    }
  },
}
