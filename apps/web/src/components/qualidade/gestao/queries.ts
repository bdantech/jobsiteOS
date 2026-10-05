import {
  lerAgregado,
  lerAnalise,
  lerConfigQualidade,
  lerContestacoes,
  lerParaRotular,
  lerPessoasQualidade,
  lerRubricas,
  lerSegredosQualidade,
  lerVinculacao,
  type Supabase,
  type TipoInteracao,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leituras da tela Comercial → Qualidade (05C §8–§13), a tela do GESTOR.
 *
 * Todas passam pelas leituras do core (`analise/leituras.ts`) com o client do USUÁRIO:
 * quem decide se a pessoa é gestora é a RPC (`app__qualidade_exige_gestor`), e ela
 * recusa com erro — que aqui vira o estado de erro da aba, não uma tela vazia que finge
 * não haver dado.
 *
 * As chaves ficam sob `['qualidade', 'gestao', ...]`: a tela do vendedor (aba Feedback)
 * usa o prefixo `['qualidade']` de outra frente, e uma decisão de contestação daqui pode
 * invalidar as duas com um só `invalidateQueries({ queryKey: ['qualidade'] })`.
 */

export const qualidadeGestaoKeys = {
  all: ['qualidade', 'gestao'] as const,
  agregado: (dias: number) => [...qualidadeGestaoKeys.all, 'agregado', dias] as const,
  contestacoes: (abertas: boolean) => [...qualidadeGestaoKeys.all, 'contestacoes', abertas] as const,
  paraRotular: (tipo: TipoInteracao) => [...qualidadeGestaoKeys.all, 'para-rotular', tipo] as const,
  analise: (id: string) => [...qualidadeGestaoKeys.all, 'analise', id] as const,
  rubricas: () => [...qualidadeGestaoKeys.all, 'rubricas'] as const,
  vinculacao: (dias: number) => [...qualidadeGestaoKeys.all, 'vinculacao', dias] as const,
  config: () => [...qualidadeGestaoKeys.all, 'config'] as const,
  pessoas: () => [...qualidadeGestaoKeys.all, 'pessoas'] as const,
  segredos: () => [...qualidadeGestaoKeys.all, 'segredos'] as const,
}

const cliente = () => createClient() as unknown as Supabase

export const buscarAgregado = (dias: number) => lerAgregado(cliente(), dias)

export const buscarContestacoes = (abertas: boolean) => lerContestacoes(cliente(), abertas)

export const buscarParaRotular = (tipo: TipoInteracao) => lerParaRotular(cliente(), tipo, 60)

/** Com o texto: a rotulagem é ler a interação inteira, como o classificador lê. */
export const buscarAnaliseComTexto = (id: string) => lerAnalise(cliente(), id, true)

/**
 * TODAS as versões de todos os tipos numa leitura só. Calibração e Rubricas leem a mesma
 * lista (a ativa de cada tipo para rotular, as versões para o relatório e o editor), e
 * uma consulta por tipo seriam três caches para a mesma verdade.
 */
export const buscarRubricas = () => lerRubricas(cliente())

export const buscarVinculacao = (dias: number) => lerVinculacao(cliente(), dias)

export const buscarConfigQualidade = () => lerConfigQualidade(cliente())

export const buscarPessoasQualidade = () => lerPessoasQualidade(cliente())

export const buscarSegredosQualidade = () => lerSegredosQualidade(cliente())
