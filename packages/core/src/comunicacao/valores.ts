import { formatarMoeda } from '../antecipacao/economia.js'
import type { Supabase } from '../registry/types.js'
import { formatCnpj } from '../schemas/cnpj.js'
import { primeiroNome, type ValoresVariaveis } from './templates.js'

/**
 * O RESOLVEDOR DAS VARIÁVEIS (§5).
 *
 * O catálogo de `templates.ts` diz o que uma chave SIGNIFICA. Este arquivo é o
 * único lugar que diz de onde ela VEM — e existe porque a alternativa já custou
 * caro: o compositor preenchia três chaves de dezessete e mandava o resto
 * literal. Um `{qtd_notas}` chegou ao WhatsApp de um fornecedor.
 *
 * ── O QUE NÃO SE RESOLVE FICA DE FORA, NÃO VAZIO ───────────────────────────
 * `renderizarTemplate` substitui `''` como qualquer outro valor: passar string
 * vazia para o que não se sabe produz "a  tem 3 notas" — uma frase quebrada que
 * ninguém revisa porque não tem chave nenhuma à vista. Omitir a chave deixa
 * `{empresa_nome}` no texto, que é feio de propósito: é o que o compositor e o
 * portão do worker enxergam para impedir o envio.
 *
 * ── QUEM NÃO MORA AQUI ─────────────────────────────────────────────────────
 * `remetente_nome` vem da sessão, e `link_agendamento` e `lista_documentos` não
 * têm fonte no sistema — são escritas à mão. `variavelEhAutomatica()` diz quais
 * são quais, para a tela de templates avisar antes de alguém montar um texto que
 * nunca vai poder ser enviado.
 */

/** As chaves que este resolvedor sabe preencher sozinho, dado empresa e contato. */
export const VARIAVEIS_AUTOMATICAS = [
  'contato_nome',
  'contato_cargo',
  'empresa_nome',
  'empresa_cnpj',
  'fornecedor_nome',
  'qtd_notas',
  'valor_total',
  'sacado_principal',
  'data_reuniao',
  'hora_reuniao',
  'data_vencimento',
  'dias_para_vencer',
  'qtd_spes',
  // Não sai do banco, mas o compositor sempre tem: é quem está logado.
  'remetente_nome',
] as const

export function variavelEhAutomatica(chave: string): boolean {
  return (VARIAVEIS_AUTOMATICAS as readonly string[]).includes(chave)
}

export interface ContextoDoDestinatario {
  empresaId: string | null
  contatoId?: string | null
  /** Quem assina. Vem da sessão; o banco não sabe quem apertou o botão. */
  remetenteNome?: string | null
}

export async function montarValoresVariaveis(
  supabase: Supabase,
  ctx: ContextoDoDestinatario,
): Promise<ValoresVariaveis> {
  const valores: Record<string, string> = {}
  const por = (chave: string, valor: string | null | undefined): void => {
    const v = (valor ?? '').trim()
    if (v !== '') valores[chave] = v
  }

  por('remetente_nome', ctx.remetenteNome)

  const [contato, empresa, notas, reuniao, certificados] = await Promise.all([
    ctx.contatoId
      ? supabase.from('contatos').select('nome, cargo').eq('id', ctx.contatoId).maybeSingle()
      : nada<{ nome: string | null; cargo: string | null }>(),
    ctx.empresaId
      ? supabase
          .from('empresas')
          .select('razao_social, nome_fantasia, cnpj')
          .eq('id', ctx.empresaId)
          .maybeSingle()
      : nada<{ razao_social: string | null; nome_fantasia: string | null; cnpj: string | null }>(),
    // As notas VIVAS da empresa como fornecedora: `faixa` nula é nota que saiu do
    // funil, e contá-la faria a mensagem prometer um valor que não existe mais.
    ctx.empresaId
      ? supabase
          .from('notas_funil')
          .select('valor, sacado_nome, sacado_cnpj, fornecedor_nome')
          .eq('fornecedor_empresa_id', ctx.empresaId)
          .not('faixa', 'is', null)
          .limit(500)
      : nadaLista<NotaResumo>(),
    // A PRÓXIMA reunião, não a última: um lembrete que fala de ontem é ruído.
    ctx.empresaId
      ? supabase
          .from('vendedor_eventos')
          .select('inicio_em')
          .eq('empresa_id', ctx.empresaId)
          .eq('tipo', 'reuniao')
          .is('cancelado_em', null)
          .gte('inicio_em', new Date().toISOString())
          .order('inicio_em', { ascending: true })
          .limit(1)
          .maybeSingle()
      : nada<{ inicio_em: string | null }>(),
    ctx.empresaId
      ? supabase
          .from('certificado_universo')
          .select('expires_at, e_matriz')
          .eq('empresa_id', ctx.empresaId)
          .limit(1000)
      : nadaLista<{ expires_at: string | null; e_matriz: boolean | null }>(),
  ])

  por('contato_nome', primeiroNome(contato.data?.nome))
  por('contato_cargo', contato.data?.cargo)
  por('empresa_nome', empresa.data?.razao_social ?? empresa.data?.nome_fantasia)
  por('empresa_cnpj', empresa.data?.cnpj ? formatCnpj(empresa.data.cnpj) : null)

  const vivas = notas.data ?? []
  if (vivas.length > 0) {
    por('qtd_notas', String(vivas.length))
    por('valor_total', formatarMoeda(vivas.reduce((s, n) => s + Number(n.valor ?? 0), 0)))
    por('sacado_principal', sacadoPrincipal(vivas))
    // O nome que a NF-e traz do fornecedor, que costuma ser mais reconhecível
    // para ele do que a razão social do nosso cadastro.
    por('fornecedor_nome', vivas.find((n) => n.fornecedor_nome)?.fornecedor_nome ?? empresa.data?.razao_social)
  }

  const inicio = reuniao.data?.inicio_em ? new Date(reuniao.data.inicio_em) : null
  if (inicio && !Number.isNaN(inicio.getTime())) {
    por('data_reuniao', formatarDataHora(inicio))
    por('hora_reuniao', formatarHora(inicio))
  }

  const universo = certificados.data ?? []
  if (universo.length > 0) {
    // O certificado de quem está do outro lado é o da MATRIZ. Só quando ela não
    // tem data é que o mais próximo do grupo responde pela pergunta.
    const comData = universo.filter((c) => c.expires_at)
    const matriz = comData.find((c) => c.e_matriz)
    const proximo =
      matriz ??
      [...comData].sort((a, b) => Date.parse(a.expires_at!) - Date.parse(b.expires_at!))[0]
    if (proximo?.expires_at) {
      const vence = new Date(proximo.expires_at)
      por('data_vencimento', formatarData(vence))
      por('dias_para_vencer', String(diasAte(vence)))
    }
    const spes = comData.filter((c) => !c.e_matriz).length
    if (spes > 0) por('qtd_spes', String(spes))
  }

  return valores as ValoresVariaveis
}

interface NotaResumo {
  valor: number | null
  sacado_nome: string | null
  sacado_cnpj: string | null
  fornecedor_nome: string | null
}

/** O sacado de maior valor agregado — é de quem a mensagem fala. */
function sacadoPrincipal(notas: readonly NotaResumo[]): string {
  const porSacado = new Map<string, number>()
  for (const n of notas) {
    const chave = n.sacado_nome ?? n.sacado_cnpj
    if (!chave) continue
    porSacado.set(chave, (porSacado.get(chave) ?? 0) + Number(n.valor ?? 0))
  }
  return [...porSacado.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

function diasAte(d: Date): number {
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000))
}

const FUSO = 'America/Sao_Paulo'

function formatarData(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatarDataHora(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatarHora(d: Date): string {
  return d.toLocaleString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' })
}

const nada = <T>(): Promise<{ data: T | null }> => Promise.resolve({ data: null })
const nadaLista = <T>(): Promise<{ data: T[] | null }> => Promise.resolve({ data: [] })
