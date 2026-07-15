'use client'

import * as React from 'react'
import { formatCnpj, type Views } from '@jobsiteos/core'
import { CamadaBadge, SituacaoBadge } from './camada-badge'
import {
  VAZIO,
  formatBooleano,
  formatCnae,
  formatDataISO,
  formatLista,
  formatM2,
  formatMoeda,
  formatMoedaExata,
  formatNumero,
  formatRatio,
  idadeEmAnos,
} from './format'

export type LinhaExplorador = Views<'mercado_explorador'>

/**
 * O catálogo de colunas do Explorador.
 *
 * `id` é SEMPRE uma coluna real da view `mercado_explorador` — é o que vai para
 * `.order()`. Uma coluna que não existe na view não é ordenável e faria a query
 * inteira falhar com um 400, então não existe coluna "virtual" aqui: `idade` é
 * derivada de `data_inicio_atividade` na renderização, mas ordena pela data (a
 * mesma inversão que o engine de filtros faz em `idade_anos`).
 */
export interface ColunaExplorador {
  id: string
  label: string
  /** Coluna usada no ORDER BY. Ausente ⇒ a coluna não é ordenável. */
  ordenarPor?: string
  /** A ordem "natural" da coluna é invertida (idade maior = data menor). */
  ordemInvertida?: boolean
  numerica?: boolean
  render: (linha: LinhaExplorador) => React.ReactNode
  /** Colunas fixas não podem ser escondidas pelo seletor. */
  fixa?: boolean
}

function Texto({ valor }: { valor: string | null }) {
  if (!valor) return <span className="text-muted-foreground">{VAZIO}</span>
  return <>{valor}</>
}

export const COLUNAS: readonly ColunaExplorador[] = [
  {
    id: 'razao_social',
    label: 'Razão social',
    ordenarPor: 'razao_social',
    fixa: true,
    render: (l) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{l.razao_social ?? formatCnpj(l.cnpj ?? '')}</p>
        {l.nome_fantasia && (
          <p className="truncate text-xs text-muted-foreground">{l.nome_fantasia}</p>
        )}
      </div>
    ),
  },
  {
    id: 'cnpj',
    label: 'CNPJ',
    ordenarPor: 'cnpj',
    render: (l) => (
      <span className="tabular-nums text-muted-foreground">{formatCnpj(l.cnpj ?? '')}</span>
    ),
  },
  {
    id: 'camada',
    label: 'Camada',
    ordenarPor: 'camada',
    render: (l) => <CamadaBadge camada={l.camada} />,
  },
  {
    id: 'situacao_cadastral',
    label: 'Situação',
    ordenarPor: 'situacao_cadastral',
    render: (l) => <SituacaoBadge situacao={l.situacao_cadastral} />,
  },
  { id: 'uf', label: 'UF', ordenarPor: 'uf', render: (l) => <Texto valor={l.uf} /> },
  {
    id: 'municipio',
    label: 'Município',
    ordenarPor: 'municipio',
    render: (l) => <Texto valor={l.municipio} />,
  },
  {
    id: 'capital_social',
    label: 'Capital social',
    ordenarPor: 'capital_social',
    numerica: true,
    render: (l) => formatMoeda(l.capital_social),
  },
  {
    id: 'data_inicio_atividade',
    label: 'Idade',
    ordenarPor: 'data_inicio_atividade',
    ordemInvertida: true,
    numerica: true,
    render: (l) => {
      const idade = idadeEmAnos(l.data_inicio_atividade)
      return idade === null ? VAZIO : `${idade} ${idade === 1 ? 'ano' : 'anos'}`
    },
  },
  {
    id: 'porte_rfb',
    label: 'Porte',
    ordenarPor: 'porte_rfb',
    render: (l) => <Texto valor={l.porte_rfb} />,
  },
  {
    id: 'natureza_juridica',
    label: 'Natureza jurídica',
    ordenarPor: 'natureza_juridica',
    render: (l) => <Texto valor={l.natureza_juridica} />,
  },
  {
    id: 'cnae_principal',
    label: 'CNAE principal',
    ordenarPor: 'cnae_principal',
    render: (l) => (
      <span className="tabular-nums">{formatCnae(l.cnae_principal)}</span>
    ),
  },
  {
    id: 'opcao_simples',
    label: 'Simples',
    ordenarPor: 'opcao_simples',
    render: (l) => formatBooleano(l.opcao_simples),
  },
  {
    id: 'qtd_filiais',
    label: 'Filiais',
    ordenarPor: 'qtd_filiais',
    numerica: true,
    render: (l) => formatNumero(l.qtd_filiais),
  },
  {
    id: 'is_spe',
    label: 'SPE',
    ordenarPor: 'is_spe',
    render: (l) => formatBooleano(l.is_spe),
  },
  {
    id: 'grupo_spes_total',
    label: 'SPEs no grupo',
    ordenarPor: 'grupo_spes_total',
    numerica: true,
    render: (l) => formatNumero(l.grupo_spes_total),
  },
  {
    id: 'grupo_spes_24m',
    label: 'SPEs (24m)',
    ordenarPor: 'grupo_spes_24m',
    numerica: true,
    render: (l) => formatNumero(l.grupo_spes_24m),
  },
  {
    id: 'grupo_ufs',
    label: 'UFs do grupo',
    render: (l) => formatLista(l.grupo_ufs),
  },
  {
    id: 'obras_ativas',
    label: 'Obras ativas',
    ordenarPor: 'obras_ativas',
    numerica: true,
    render: (l) => formatNumero(l.obras_ativas),
  },
  {
    id: 'obras_iniciadas_24m',
    label: 'Obras (24m)',
    ordenarPor: 'obras_iniciadas_24m',
    numerica: true,
    render: (l) => formatNumero(l.obras_iniciadas_24m),
  },
  {
    id: 'm2_em_execucao',
    label: 'm² em execução',
    ordenarPor: 'm2_em_execucao',
    numerica: true,
    render: (l) => formatM2(l.m2_em_execucao),
  },
  {
    id: 'erp_atual',
    label: 'ERP atual',
    ordenarPor: 'erp_atual',
    render: (l) => <Texto valor={l.erp_atual} />,
  },
  {
    // NÃO é receita da ONE OS: é o que a empresa paga pelo ERP que usa hoje.
    id: 'erp_mrr',
    label: 'MRR do ERP',
    ordenarPor: 'erp_mrr',
    numerica: true,
    render: (l) => formatMoedaExata(l.erp_mrr),
  },
  {
    id: 'qtd_usuarios_erp',
    label: 'Usuários do ERP',
    ordenarPor: 'qtd_usuarios_erp',
    numerica: true,
    render: (l) => formatNumero(l.qtd_usuarios_erp),
  },
  {
    id: 'ratio_usuarios_ativos',
    label: 'Uso do ERP',
    ordenarPor: 'ratio_usuarios_ativos',
    numerica: true,
    render: (l) => formatRatio(l.ratio_usuarios_ativos),
  },
  {
    id: 'churn_erp_concorrente',
    label: 'Churn concorrente',
    ordenarPor: 'churn_erp_concorrente',
    render: (l) => formatBooleano(l.churn_erp_concorrente),
  },
  {
    id: 'tem_contato',
    label: 'Tem contato',
    ordenarPor: 'tem_contato',
    render: (l) => formatBooleano(l.tem_contato),
  },
  {
    id: 'grafo_sefaz',
    label: 'Grafo SEFAZ',
    ordenarPor: 'grafo_sefaz',
    render: (l) => formatBooleano(l.grafo_sefaz),
  },
  {
    id: 'estagio',
    label: 'Estágio',
    ordenarPor: 'estagio',
    render: (l) => <Texto valor={l.estagio} />,
  },
  {
    id: 'data_exclusao_simples',
    label: 'Saiu do Simples',
    ordenarPor: 'data_exclusao_simples',
    render: (l) => formatDataISO(l.data_exclusao_simples),
  },
]

export const COLUNAS_POR_ID = new Map(COLUNAS.map((c) => [c.id, c]))

/** As colunas fixas nunca saem — o seletor não as oferece. */
export const COLUNAS_FIXAS = COLUNAS.filter((c) => c.fixa).map((c) => c.id)

export const COLUNAS_PADRAO: readonly string[] = [
  'razao_social',
  'cnpj',
  'camada',
  'situacao_cadastral',
  'uf',
  'municipio',
  'capital_social',
  'obras_ativas',
  'erp_atual',
]

const CHAVE_STORAGE = 'jobsiteos.mercado.explorador.colunas.v1'

function ler(): string[] | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE_STORAGE)
    if (!bruto) return null

    const parsed: unknown = JSON.parse(bruto)
    if (!Array.isArray(parsed)) return null

    // Uma coluna que saiu do catálogo (renomeada, removida) viraria um ORDER BY
    // ou um <th> fantasma. Filtra contra o catálogo atual, sempre.
    const validas = parsed.filter((id): id is string => typeof id === 'string' && COLUNAS_POR_ID.has(id))
    return validas.length > 0 ? validas : null
  } catch {
    // localStorage bloqueado (modo privado, política de cookies) não pode
    // derrubar a página inteira — só significa "sem preferência salva".
    return null
  }
}

function gravar(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(CHAVE_STORAGE, JSON.stringify(ids))
  } catch {
    /* sem persistência: a sessão atual continua funcionando */
  }
}

/**
 * A preferência de colunas é do USUÁRIO, não da URL — duas pessoas abrindo o
 * mesmo link compartilhado veem o mesmo recorte de dados, cada uma com as suas
 * colunas. Por isso localStorage, e não query string.
 *
 * O estado inicial é o padrão (nunca o localStorage) para não divergir do HTML
 * do servidor: a leitura acontece no efeito, depois da hidratação.
 */
export function useColunasVisiveis() {
  const [ids, setIds] = React.useState<readonly string[]>(COLUNAS_PADRAO)
  const [carregado, setCarregado] = React.useState(false)

  React.useEffect(() => {
    const salvas = ler()
    if (salvas) setIds(salvas)
    setCarregado(true)
  }, [])

  const alternar = React.useCallback((id: string) => {
    setIds((atuais) => {
      const coluna = COLUNAS_POR_ID.get(id)
      if (!coluna || coluna.fixa) return atuais

      const proximas = atuais.includes(id)
        ? atuais.filter((c) => c !== id)
        : // Mantém a ordem do catálogo, não a ordem em que a pessoa clicou:
          // a tabela precisa ser previsível entre sessões.
          COLUNAS.filter((c) => c.id === id || atuais.includes(c.id)).map((c) => c.id)

      gravar(proximas)
      return proximas
    })
  }, [])

  const restaurarPadrao = React.useCallback(() => {
    setIds(COLUNAS_PADRAO)
    gravar(COLUNAS_PADRAO)
  }, [])

  const colunas = React.useMemo(
    () => COLUNAS.filter((c) => ids.includes(c.id)),
    [ids],
  )

  return { colunas, ids, alternar, restaurarPadrao, carregado }
}
