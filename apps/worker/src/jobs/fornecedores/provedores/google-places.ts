import {
  mapearGooglePlaces,
  type ContatoDeProvedor,
  type LugarGoogle,
} from '../../../../../../packages/core/src/fornecedores/provedores.js'
import { env } from '../../../env.js'
import { logger } from '../../../logger.js'
import { requisitarJson } from '../../../net/http.js'
import type { CadastralFornecedor } from '../descoberta.js'

/**
 * Google Places (§4.1.5) — o provedor novo, e o único pago da camada automática.
 *
 * Cobertura excelente para PME local de construção: serralheria, marmoraria e
 * locadora de equipamento têm ficha no Maps mesmo sem site, porque é onde o cliente
 * final as procura. É exatamente a faixa em que o Apollo não tem nada — e por isso
 * ele vale o centavo por consulta que o Apollo não vale.
 *
 * ─── TEXT SEARCH, NÃO FIND PLACE ─────────────────────────────────────────────
 *
 * `searchText` aceita "RAZÃO SOCIAL, MUNICÍPIO, UF" como uma frase e resolve
 * abreviação e grafia. `findPlaceFromText` exigiria o nome como está no Maps, que é
 * justamente o que não sabemos — o nome fantasia da serralheria raramente é a razão
 * social que a Receita guarda.
 *
 * ─── FIELDMASK É OBRIGATÓRIO E É O QUE COBRA ─────────────────────────────────
 *
 * A Places API v1 cobra por FAIXA DE CAMPOS. Pedir o mundo custa várias vezes mais
 * que pedir cinco campos, e um `*` no fieldMask é a forma de descobrir isso na
 * fatura. Aqui a lista é fechada e é a mínima que responde à pergunta.
 */

const PLACES = 'https://places.googleapis.com/v1/places:searchText'

const CAMPOS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
].join(',')

export interface ResultadoPlaces {
  contatos: ContatoDeProvedor[]
  /** true quando a API respondeu; false quando não há chave configurada. */
  disponivel: boolean
  erro?: string
}

export async function buscarNoGooglePlaces(
  cadastral: CadastralFornecedor,
): Promise<ResultadoPlaces> {
  if (!env.GOOGLE_PLACES_API_KEY) {
    return { contatos: [], disponivel: false, erro: 'GOOGLE_PLACES_API_KEY não configurada.' }
  }

  const nome = cadastral.nome_fantasia || cadastral.razao_social
  if (!nome) return { contatos: [], disponivel: true, erro: 'Sem razão social para consultar.' }

  const consulta = [nome, cadastral.municipio, cadastral.uf].filter(Boolean).join(', ')

  try {
    const resp = await requisitarJson<{ places?: LugarGoogle[] }>(PLACES, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': CAMPOS,
      },
      body: {
        textQuery: consulta,
        languageCode: 'pt-BR',
        regionCode: 'BR',
        // Um resultado só. A API cobra por CONSULTA, não por resultado, mas o
        // segundo lugar de uma busca por razão social quase nunca é a mesma
        // empresa — e um telefone "quase certo" é pior que nenhum.
        maxResultCount: 1,
      },
      timeoutMs: 15_000,
      tentativas: 2,
    })

    const lugar = resp.places?.[0]
    if (!lugar) return { contatos: [], disponivel: true }

    return {
      contatos: mapearGooglePlaces(
        lugar,
        {
          municipio: cadastral.municipio,
          uf: cadastral.uf,
          logradouro: cadastral.logradouro,
          numero: cadastral.numero,
        },
        { dddPadrao: cadastral.ddd },
      ),
      disponivel: true,
    }
  } catch (e) {
    logger.error({ cnpj: cadastral.cnpj, erro: String(e) }, 'Google Places falhou.')
    return { contatos: [], disponivel: true, erro: String(e) }
  }
}
