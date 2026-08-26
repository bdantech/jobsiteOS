import {
  desembrulharTokenNovaVida,
  erroDeConsultaNovaVida,
  expiracaoTokenNovaVida,
  formaDaResposta,
  mapearNovaVida,
  tokenNovaVidaEhErro,
  tokenNovaVidaExpirado,
  type CadastraisNovaVida,
  type ContatoDeProvedor,
} from '../../../../../../packages/core/src/fornecedores/provedores.js'
import { supabaseAdmin } from '../../../db.js'
import { env } from '../../../env.js'
import { logger } from '../../../logger.js'
import { requisitarJson } from '../../../net/http.js'
import type { CadastralFornecedor } from '../descoberta.js'

/**
 * Nova Vida TI (§4.2a): telefone e e-mail dos SÓCIOS.
 *
 * Em PME de construção o sócio quase sempre É quem decide sobre antecipar recebível
 * — não há diretor financeiro para o Apollo achar. É por isso que este provedor vem
 * ANTES do Apollo na cascata paga, apesar de a informação ser de pessoa física.
 *
 * ─── DUAS ARMADILHAS, AMBAS APRENDIDAS NA PRÁTICA ────────────────────────────
 *
 * 1. ERRO VEM COM HTTP 200. Credencial errada e cota esgotada voltam como TEXTO PURO
 *    no corpo, status 200, no lugar do token. Um cliente que só olha o status guarda
 *    "USUARIO OU SENHA INCORRETO" no cache por 23,5 horas como se fosse a
 *    credencial, e a integração passa um dia inteiro devolvendo "sem dados" em vez
 *    de "não autenticou". A detecção mora no core, com teste.
 *
 * 2. O TOKEN VALE 24H E NÃO PODE SER GERADO POR REQUISIÇÃO. Guardá-lo por 23,5h (e
 *    não 24) é o que impede que a última consulta da janela use um token que expira
 *    no meio do voo — cujo erro é indistinguível de um CNPJ desconhecido.
 *
 * As credenciais vêm SÓ de env, nunca de config, e nunca são logadas.
 */

const BASE = 'https://wsnv.novavidati.com.br/WSLocalizador.asmx'
const PROVEDOR = 'novavida'

function temCredenciais(): boolean {
  return Boolean(env.NOVAVIDA_USUARIO && env.NOVAVIDA_SENHA && env.NOVAVIDA_CLIENTE)
}

async function tokenDoCache(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('integracao_tokens')
    .select('token, expira_em')
    .eq('provedor', PROVEDOR)
    .maybeSingle()
  if (!data) return null
  return tokenNovaVidaExpirado(data.expira_em, new Date()) ? null : data.token
}

async function gerarToken(): Promise<string | null> {
  const resp = await requisitarJson<unknown>(`${BASE}/GerarTokenJson`, {
    method: 'POST',
    body: {
      credencial: {
        usuario: env.NOVAVIDA_USUARIO,
        senha: env.NOVAVIDA_SENHA,
        cliente: env.NOVAVIDA_CLIENTE,
      },
    },
    timeoutMs: 20_000,
    tentativas: 2,
  })

  const bruto = desembrulharTokenNovaVida(resp)
  if (tokenNovaVidaEhErro(bruto)) {
    // O conteúdo NÃO é logado: se for um token, é credencial; se for erro, o texto
    // da Nova Vida às vezes ecoa o usuário. O tamanho basta para diagnosticar.
    logger.error({ tamanho: bruto?.length ?? 0 }, 'Nova Vida recusou a credencial (HTTP 200 com texto de erro).')
    return null
  }

  const token = bruto as string
  await supabaseAdmin.from('integracao_tokens').upsert(
    {
      provedor: PROVEDOR,
      token,
      expira_em: expiracaoTokenNovaVida(new Date()).toISOString(),
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'provedor' },
  )
  return token
}

export interface ResultadoNovaVida {
  contatos: ContatoDeProvedor[]
  disponivel: boolean
  erro?: string
  /**
   * A FORMA da resposta quando ela não rendeu contato nenhum. É o que separa "este
   * CNPJ não tem contato" de "o mapeamento errou a chave" — duas hipóteses que pedem
   * ações opostas e que, sem isto, só se distinguiriam repetindo a consulta paga.
   *
   * Ela já se pagou uma vez: foi o registro `{d: {CONSULTA: {... TELEFONES: [4× …]}}}`
   * que mostrou que o parser antigo estava jogando fora quatro telefones.
   */
  forma?: string
  /** Porte, headcount e faturamento presumido, que vêm de graça na mesma consulta. */
  cadastrais?: CadastraisNovaVida | null
  /** Telefones que a própria base marca como ruins e que não viraram contato. */
  descartados?: number
}

export async function buscarNaNovaVida(cadastral: CadastralFornecedor): Promise<ResultadoNovaVida> {
  if (!temCredenciais()) {
    return { contatos: [], disponivel: false, erro: 'Credenciais NOVAVIDA_* não configuradas.' }
  }

  try {
    const token = (await tokenDoCache()) ?? (await gerarToken())
    if (!token) return { contatos: [], disponivel: true, erro: 'Não foi possível autenticar na Nova Vida.' }

    const resp = await requisitarJson<unknown>(`${BASE}/NVCHECKJson`, {
      method: 'POST',
      headers: { token },
      body: { nvcheck: { Documento: cadastral.cnpj } },
      timeoutMs: 30_000,
      tentativas: 2,
    })

    /*
     * A CONSULTA também devolve erro como TEXTO com HTTP 200 (doc §2): credencial
     * errada, consulta não liberada, cota do cliente e cota do usuário. Só o token
     * era verificado — um "SEM ACESSO AO SISTEMA" virava zero contatos com R$ 0,35
     * cobrados e nada dizendo por quê.
     */
    const erroTexto = erroDeConsultaNovaVida(resp)
    if (erroTexto) {
      logger.error({ cnpj: cadastral.cnpj, resposta: erroTexto }, 'Nova Vida recusou a consulta.')
      return { contatos: [], disponivel: true, erro: erroTexto }
    }

    const r = mapearNovaVida(resp, { dddPadrao: cadastral.ddd })
    if (r.contatos.length === 0) {
      // Só nomes de chave e tipos — a resposta traz nome, CPF e telefone de pessoa
      // física, e um log de diagnóstico não é lugar para isso.
      const forma = formaDaResposta(resp)
      logger.info({ cnpj: cadastral.cnpj, forma }, 'Nova Vida respondeu sem contato mapeável.')
      return { contatos: [], disponivel: true, forma, cadastrais: r.cadastrais, descartados: r.descartados }
    }
    return {
      contatos: r.contatos,
      disponivel: true,
      cadastrais: r.cadastrais,
      descartados: r.descartados,
    }
  } catch (e) {
    logger.error({ cnpj: cadastral.cnpj, erro: String(e) }, 'Consulta à Nova Vida falhou.')
    return { contatos: [], disponivel: true, erro: String(e) }
  }
}
