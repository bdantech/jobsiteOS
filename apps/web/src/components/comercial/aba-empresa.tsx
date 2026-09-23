'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, Mail, MessageCircle } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { telefoneLegivel } from '@/components/comunicacao/format'
import { ContatosDoFornecedor } from './fornecedores/contatos-do-fornecedor'

/**
 * A aba "Empresa" — a mesma nos quatro funis.
 *
 * A camada do meio de todo card: o item muda (nota, lead, negócio, certificado), a
 * empresa por trás não. Repetir esse bloco em quatro telas garantiria que quatro
 * pessoas resolvessem "o que é importante saber de uma empresa" de quatro jeitos.
 *
 * É um RESUMO, não a Company 360: o que cabe decidir sem sair do funil. Quando não
 * cabe, o botão leva para a ficha inteira.
 */

interface EmpresaResumo {
  id: string
  cnpj: string | null
  razao_social: string | null
  nome_fantasia: string | null
  uf: string | null
  municipio: string | null
  estagio: string | null
  tipo: string | null
  erp_atual: string | null
  faturamento_anual: number | null
  valor_esperado_mensal: number | null
  gestao_operacao: string | null
}

interface ContatoResumo {
  id: string
  nome: string | null
  cargo: string | null
  email: string | null
  telefone: string | null
  whatsapp: string | null
  ponto_focal: boolean | null
}

const brl = (n: number | null) =>
  n === null || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

async function buscarResumo(empresaId: string) {
  const supabase = createClient()
  const [{ data: empresa }, { data: contatos }] = await Promise.all([
    supabase
      .from('empresas')
      .select(
        'id, cnpj, razao_social, nome_fantasia, uf, municipio, estagio, tipo, erp_atual, faturamento_anual, valor_esperado_mensal, gestao_operacao',
      )
      .eq('id', empresaId)
      .maybeSingle(),
    supabase
      .from('contatos')
      .select('id, nome, cargo, email, telefone, whatsapp, ponto_focal')
      .eq('empresa_id', empresaId)
      // Ponto focal primeiro: numa lista de dez contatos enriquecidos, é o único que
      // alguém curou, e é para ele que se liga.
      .order('ponto_focal', { ascending: false })
      // Era 5. Virou 20 porque a lista deixou de ser um resumo: é daqui que se
      // escolhe para quem mandar, e um contato escondido no corte é um contato
      // que não recebe mensagem.
      .limit(20),
  ])
  return {
    empresa: (empresa as EmpresaResumo | null) ?? null,
    contatos: (contatos ?? []) as ContatoResumo[],
  }
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{rotulo}</span>
      <span className="min-w-0 truncate text-right">{valor}</span>
    </div>
  )
}

/**
 * O LINK DE ANTECIPAÇÃO DESTA NOTA.
 *
 * ── POR QUE ELE MORA NA ABA DO FORNECEDOR ──────────────────────────────────
 * O link leva quem EMITIU a nota ao pedido de antecipação já preenchido, e a
 * autorização é conferida na abertura: CNPJ da conta = CNPJ do emissor.
 * Mandá-lo ao sacado não vaza nada (ele veria um resumo com o CNPJ oculto), mas
 * é uma mensagem inútil. O destinatário certo é sempre o fornecedor — e esta é
 * a aba onde se decide com quem falar.
 *
 * ── A CONSULTA É PRÓPRIA, E PEQUENA ────────────────────────────────────────
 * Poderia vir junto do XML que o modal já busca, mas aquele `select` traz
 * `raw_xml` — dezenas a centenas de KB. Esta pede uma coluna.
 *
 * ── NULO NÃO É FALHA ───────────────────────────────────────────────────────
 * Cerca de um terço das notas recebidas não tem link, por desenho: resumo sem
 * XML completo, cancelada, emissor sem CNPJ, valor fora da faixa. Dizer "—"
 * faria a pessoa procurar defeito onde não há; a frase explica e encerra.
 */
function LinhaLinkAntecipacao({ accessKey }: { accessKey: string }) {
  const [copiado, setCopiado] = React.useState(false)

  const q = useQuery({
    queryKey: ['antecipacao', 'link-da-nota', accessKey],
    queryFn: async () => {
      const { data } = await createClient()
        .from('notas_fiscais')
        .select('link_antecipacao')
        .eq('access_key', accessKey)
        .maybeSingle<{ link_antecipacao: string | null }>()
      return data?.link_antecipacao ?? null
    },
  })

  if (q.isPending) {
    return <Linha rotulo="Link de antecipação" valor={<Skeleton className="h-4 w-40" />} />
  }

  const link = q.data
  if (!link) {
    return (
      <Linha
        rotulo="Link de antecipação"
        valor={<span className="text-xs text-muted-foreground">Esta nota não tem link ativo.</span>}
      />
    )
  }

  const copiar = () => {
    /*
     * O valor é copiado COMO VEIO. Encurtar, reescrever ou remontar a URL a
     * partir da chave quebraria o link: o token tem 43 caracteres e é opaco —
     * não é derivável de nada que esteja nesta tela.
     */
    void navigator.clipboard.writeText(link).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    })
  }

  return (
    <Linha
      rotulo="Link de antecipação"
      valor={
        <span className="flex items-center justify-end gap-1">
          <span className="min-w-0 truncate font-mono text-xs" title={link}>
            {link}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 shrink-0 p-0"
            onClick={copiar}
            aria-label={copiado ? 'Link copiado' : 'Copiar link'}
          >
            {copiado ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0" asChild>
            <a href={link} target="_blank" rel="noopener noreferrer" aria-label="Abrir link">
              <ExternalLink className="size-3" />
            </a>
          </Button>
        </span>
      }
    />
  )
}

export function AbaEmpresa({
  empresaId,
  fornecedorCnpj,
  fornecedorNome,
  notaAccessKey,
  onMandarMensagem,
}: {
  empresaId: string | null
  /**
   * O CNPJ do fornecedor, quando o card veio do funil de NFs. É ele que traz o
   * agente de contato para esta aba — que é onde ele deveria estar desde o
   * começo: "com quem falar" é uma pergunta sobre o FORNECEDOR, e o compositor
   * é onde se escreve depois de já saber a resposta.
   */
  fornecedorCnpj?: string | null
  fornecedorNome?: string | null
  /**
   * A chave de acesso da NF, quando o card é uma nota. Só com ela esta aba mostra
   * o link de antecipação — ele é de UMA nota, não da empresa, e um fornecedor
   * com doze notas tem doze links diferentes.
   */
  notaAccessKey?: string | null
  /** Quando dado, cada contato ganha o botão que abre o compositor já nele. */
  onMandarMensagem?: (contatoId: string) => void
}) {
  /*
   * A empresa resolvida PELO CNPJ quando o card ainda não a conhece: ela passa a
   * existir no instante em que alguém promove ou cadastra um contato, e o prop
   * continuaria nulo até o Kanban inteiro recarregar.
   */
  const resolvida = useQuery({
    queryKey: ['comercial', 'empresa-do-cnpj', fornecedorCnpj],
    queryFn: async () => {
      const { data } = await createClient()
        .from('empresas')
        .select('id')
        .eq('cnpj', fornecedorCnpj!)
        .maybeSingle()
      return data?.id ?? null
    },
    enabled: !empresaId && Boolean(fornecedorCnpj),
  })

  const id = empresaId ?? resolvida.data ?? null

  const q = useQuery({
    queryKey: ['comercial', 'empresa-resumo', id],
    queryFn: () => buscarResumo(id!),
    enabled: !!id,
  })

  const agente = fornecedorCnpj ? (
    <ContatosDoFornecedor
      cnpj={fornecedorCnpj}
      nomeFornecedor={fornecedorNome ?? 'este fornecedor'}
    />
  ) : null

  if (!id) {
    return (
      agente ?? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Este item ainda não está ligado a uma empresa na base.
        </p>
      )
    )
  }
  if (q.isPending) return <Skeleton className="h-56 w-full" />

  const e = q.data?.empresa
  if (!e) {
    return (
      agente ?? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Empresa não encontrada.
        </p>
      )
    )
  }

  const contatos = q.data?.contatos ?? []

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{e.razao_social ?? e.nome_fantasia ?? '—'}</p>
          {e.estagio ? <Badge variant="outline">{e.estagio}</Badge> : null}
          {e.tipo ? <Badge variant="secondary">{e.tipo}</Badge> : null}
        </div>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {e.cnpj ? formatCnpj(e.cnpj) : '—'}
        </p>
      </div>

      <div>
        <Linha rotulo="Local" valor={[e.municipio, e.uf].filter(Boolean).join(' · ') || '—'} />
        <Linha rotulo="Faturamento anual" valor={brl(e.faturamento_anual)} />
        {/*
         * O valor esperado é a régua do Crédito (limite × giro × taxa × chance), e é
         * por ele que a distribuição ordena. Aparece aqui porque é o número que
         * responde "vale a pena insistir nesta?" sem sair do funil.
         */}
        <Linha rotulo="Valor esperado" valor={`${brl(e.valor_esperado_mensal)}/mês`} />
        <Linha rotulo="ERP atual" valor={e.erp_atual ?? '—'} />
        <Linha rotulo="Gestão" valor={e.gestao_operacao ?? '—'} />
        {notaAccessKey ? <LinhaLinkAntecipacao accessKey={notaAccessKey} /> : null}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Contatos</p>
        {contatos.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Nenhum contato cadastrado.
          </p>
        ) : (
          <ul className="space-y-1">
            {contatos.map((c) => {
              const fone = c.whatsapp ?? c.telefone
              return (
                <li key={c.id} className="rounded-md border p-2 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.nome ?? '—'}</span>
                        {c.ponto_focal ? (
                          <Badge variant="outline" className="text-[10px]">
                            ponto focal
                          </Badge>
                        ) : null}
                        {c.cargo ? (
                          <span className="text-xs text-muted-foreground">{c.cargo}</span>
                        ) : null}
                      </div>
                      {/* O número como se lê em voz alta, e não como o provedor o
                          guarda: quem confere um contato antes de ligar não deveria
                          precisar contar dígitos. */}
                      <p className="text-xs text-muted-foreground">
                        {[c.email, fone ? telefoneLegivel(fone) : null]
                          .filter(Boolean)
                          .join(' · ') || 'sem canal'}
                      </p>
                    </div>
                    {/*
                      ESCOLHER AQUI, ESCREVER LÁ.
                      
                      A aba "Comunicação" abria sempre no primeiro contato da lista e
                      deixava a troca para um seletor dentro do compositor — o que
                      obriga a decidir para quem falar numa tela que já está pedindo
                      o que falar. A decisão é desta aba, onde os contatos estão com
                      cargo e procedência à vista.
                    */}
                    {onMandarMensagem && (c.email || fone) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => onMandarMensagem(c.id)}
                      >
                        {fone ? (
                          <MessageCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <Mail className="mr-1 h-3.5 w-3.5" aria-hidden />
                        )}
                        Mensagem
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {agente}

      <Button variant="outline" size="sm" asChild className="w-full">
        <Link href={`/empresas/${e.id}`}>
          Abrir a Company 360
          <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
        </Link>
      </Button>
    </div>
  )
}
