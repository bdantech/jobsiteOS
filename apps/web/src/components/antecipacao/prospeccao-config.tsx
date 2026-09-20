'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { salvarProspeccaoConfigAction } from '@/actions/prospeccao'
import {
  CONFIG_PROSPECCAO_PADRAO,
  buscarConfigProspeccao,
  prospeccaoKeys,
  type ConfigProspeccao,
} from './prospeccao-queries'

/**
 * Settings do funil de Sacados por NF (04r §8). `webOnly`, como toda régua.
 *
 * A separação em relação a `antecipacao-config.tsx` é de TABELA, não de gosto:
 * `prospeccao_config` e `antecipacao_config` guardam um jsonb por chave, e um único
 * formulário que escrevesse nas duas teria de saber, campo a campo, qual RPC chamar.
 * Duas tabelas, dois blocos, duas RPCs.
 *
 * ─── O QUE CADA NÚMERO MUDA ─────────────────────────────────────────────────
 *
 * `corte_volume` decide o tamanho da lista, e ele é o que separa funil de lista morta:
 * medido em 20/09/2026, sem corte são 886 sacados; com R$ 30 mil, 243.
 * `margem_prazo_dias` e `tempo_esteira_dias` decidem o que conta como OPERÁVEL — mexer
 * neles muda o segundo número de todo card da tela.
 */

type Rascunho = Partial<{
  janela_emissao_dias: number
  janela_recorrencia_meses: number
  corte_volume: number
  margem_prazo_dias: number
  tempo_esteira_dias: number
  esteira_base_minima: number
  max_cards_por_originador: number
  exigir_contratante: boolean
  teto_mensal_por_originador: number
  limiar_valor_esperado_mensal: number
  abordagem_fornecedor: string
  pedido_ponte: string
}>

export function ProspeccaoConfig() {
  const qc = useQueryClient()
  const [rascunho, setRascunho] = React.useState<Rascunho>({})
  const [salvando, setSalvando] = React.useState(false)

  const { data = CONFIG_PROSPECCAO_PADRAO, isPending } = useQuery({
    queryKey: prospeccaoKeys.config(),
    queryFn: buscarConfigProspeccao,
  })

  function num<K extends keyof Rascunho>(chave: K, atual: number): number {
    const v = rascunho[chave]
    return typeof v === 'number' ? v : atual
  }
  function texto(chave: 'abordagem_fornecedor' | 'pedido_ponte', atual: string): string {
    const v = rascunho[chave]
    return typeof v === 'string' ? v : atual
  }

  async function salvar() {
    setSalvando(true)
    /*
     * Um RPC por GRUPO, com o valor atual espalhado por baixo: a tabela guarda um jsonb
     * por chave, e salvar campo a campo apagaria os irmãos dele dentro do mesmo objeto.
     */
    const grupos: { chave: keyof ConfigProspeccao; valor: unknown }[] = [
      {
        chave: 'janelas',
        valor: {
          janela_emissao_dias: num('janela_emissao_dias', data.janelas.janela_emissao_dias),
          janela_recorrencia_meses: num(
            'janela_recorrencia_meses',
            data.janelas.janela_recorrencia_meses,
          ),
        },
      },
      { chave: 'corte_volume', valor: num('corte_volume', data.corte_volume) },
      {
        chave: 'prazo',
        valor: {
          margem_prazo_dias: num('margem_prazo_dias', data.prazo.margem_prazo_dias),
          tempo_esteira_dias: num('tempo_esteira_dias', data.prazo.tempo_esteira_dias),
          esteira_base_minima: num('esteira_base_minima', data.prazo.esteira_base_minima),
        },
      },
      {
        chave: 'max_cards_por_originador',
        valor: num('max_cards_por_originador', data.max_cards_por_originador),
      },
      {
        chave: 'exigir_contratante',
        valor: rascunho.exigir_contratante ?? data.exigir_contratante,
      },
      {
        chave: 'enriquecimento',
        valor: {
          ...data.enriquecimento,
          teto_mensal_por_originador: num(
            'teto_mensal_por_originador',
            data.enriquecimento.teto_mensal_por_originador,
          ),
        },
      },
      {
        chave: 'notificacao',
        valor: {
          limiar_valor_esperado_mensal: num(
            'limiar_valor_esperado_mensal',
            data.notificacao.limiar_valor_esperado_mensal,
          ),
        },
      },
      {
        chave: 'templates',
        valor: {
          abordagem_fornecedor: texto(
            'abordagem_fornecedor',
            data.templates.abordagem_fornecedor,
          ),
          pedido_ponte: texto('pedido_ponte', data.templates.pedido_ponte),
        },
      },
    ]

    for (const g of grupos) {
      const r = await salvarProspeccaoConfigAction({ chave: g.chave, valor: g.valor })
      if (!r.ok) {
        setSalvando(false)
        toast.error(r.message)
        return
      }
    }
    setSalvando(false)
    setRascunho({})
    toast.success('Configurações de Sacados por NF salvas.')
    void qc.invalidateQueries({ queryKey: prospeccaoKeys.all })
  }

  if (isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  const alterado = Object.keys(rascunho).length > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-base">Sacados por NF</CardTitle>
        </div>
        <CardDescription>
          A régua do funil de aquisição de sacado. <strong>Corte de volume</strong> decide o
          tamanho da lista; <strong>margem de prazo</strong> e <strong>tempo de esteira</strong>{' '}
          decidem o que conta como operável — e esse é o segundo número de todo card.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="cfg-janela-emissao">Janela de emissão (dias)</Label>
            <Input
              id="cfg-janela-emissao"
              type="number"
              min={1}
              value={num('janela_emissao_dias', data.janelas.janela_emissao_dias)}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, janela_emissao_dias: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              O período do &ldquo;volume observado&rdquo; e da entrada no funil.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-janela-recorrencia">Janela de recorrência (meses)</Label>
            <Input
              id="cfg-janela-recorrencia"
              type="number"
              min={1}
              max={24}
              value={num('janela_recorrencia_meses', data.janelas.janela_recorrencia_meses)}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, janela_recorrencia_meses: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              É o que separa o pico de uma anuidade — e o denominador da média mensal.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-corte">Corte de volume (R$)</Label>
            <Input
              id="cfg-corte"
              type="number"
              min={0}
              step={1000}
              value={num('corte_volume', data.corte_volume)}
              onChange={(e) => setRascunho((r) => ({ ...r, corte_volume: Number(e.target.value) }))}
            />
            <p className="text-xs text-muted-foreground">
              Sem corte a base tem 886 sacados; a R$ 30 mil, 243.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-margem">Margem de prazo (dias)</Label>
            <Input
              id="cfg-margem"
              type="number"
              min={0}
              value={num('margem_prazo_dias', data.prazo.margem_prazo_dias)}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, margem_prazo_dias: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Somada ao tempo de esteira: é o mínimo de vida que uma nota precisa ter.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-esteira">Tempo de esteira — padrão (dias)</Label>
            <Input
              id="cfg-esteira"
              type="number"
              min={0}
              value={num('tempo_esteira_dias', data.prazo.tempo_esteira_dias)}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, tempo_esteira_dias: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Só vale quando não há amostra: o número usado é o MEDIDO nas análises decididas.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-base">Amostra mínima da esteira</Label>
            <Input
              id="cfg-base"
              type="number"
              min={1}
              value={num('esteira_base_minima', data.prazo.esteira_base_minima)}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, esteira_base_minima: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Abaixo disso, o medido não vale. Com 7 análises a mediana é de horas — e isso
              marcaria como operável toda nota que vence amanhã.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-max-cards">Máximo de cards por originador</Label>
            <Input
              id="cfg-max-cards"
              type="number"
              min={1}
              value={num('max_cards_por_originador', data.max_cards_por_originador)}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, max_cards_por_originador: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Vale só na ENTRADA: card já aberto nunca é cortado por ranking.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-teto">Teto mensal de enriquecimento (R$)</Label>
            <Input
              id="cfg-teto"
              type="number"
              min={0}
              value={num(
                'teto_mensal_por_originador',
                data.enriquecimento.teto_mensal_por_originador,
              )}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, teto_mensal_por_originador: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">Por originador, em consultas pagas.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-limiar">Limiar do push (R$/mês esperado)</Label>
            <Input
              id="cfg-limiar"
              type="number"
              min={0}
              value={num(
                'limiar_valor_esperado_mensal',
                data.notificacao.limiar_valor_esperado_mensal,
              )}
              onChange={(e) =>
                setRascunho((r) => ({
                  ...r,
                  limiar_valor_esperado_mensal: Number(e.target.value),
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Em valor ESPERADO, não em volume: avisar sobre um pico que a esteira não vai
              aprovar é ensinar a ignorar o aviso.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Switch
            id="cfg-contratante"
            checked={rascunho.exigir_contratante ?? data.exigir_contratante}
            onCheckedChange={(v) => setRascunho((r) => ({ ...r, exigir_contratante: v }))}
          />
          <div className="space-y-0.5">
            <Label htmlFor="cfg-contratante">Só construtoras e incorporadoras</Label>
            <p className="text-xs text-muted-foreground">
              Recorte por CNAE (divisão 41/42 ou grupo 6810). Desligado, a lista volta a incluir
              todo CNPJ que apareceu como destinatário — posto de gasolina, papelaria, o contador
              do fornecedor. Dos 243 sacados acima do corte, 114 contratam obra.
            </p>
          </div>
        </div>

        {/*
         * §6 — O GUARDRAIL DE RELACIONAMENTO, dito onde alguém pode reescrever o texto.
         *
         * Os dois templates falam com o CEDENTE, que é o dono do dado. Nenhum fala com a
         * construtora — e se um dia falar, ele não pode citar volume, nome de fornecedor
         * nem detalhe de nota: devolver ao sacado o que o fornecedor cedeu para antecipar
         * soa como vigilância.
         */}
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Templates de abordagem</p>
            <p className="text-xs text-muted-foreground">
              Os dois textos vão para o <strong>cedente</strong> — são as notas dele. Nenhuma
              mensagem deste funil vai para a construtora, e nenhuma pode citar volume, nome de
              fornecedor ou detalhe de nota se um dia for.{' '}
              {'{sacado_nome}'}, {'{valor_total}'} e {'{fornecedor_nome}'} são preenchidos a
              partir do card; {'{remetente_nome}'} e {'{contato_nome}'}, pelo compositor.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-tpl-abordagem">Falar com o cedente</Label>
            <Textarea
              id="cfg-tpl-abordagem"
              rows={3}
              value={texto('abordagem_fornecedor', data.templates.abordagem_fornecedor)}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, abordagem_fornecedor: e.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-tpl-ponte">Pedir apresentação</Label>
            <Textarea
              id="cfg-tpl-ponte"
              rows={4}
              value={texto('pedido_ponte', data.templates.pedido_ponte)}
              onChange={(e) => setRascunho((r) => ({ ...r, pedido_ponte: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button disabled={!alterado || salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
          {alterado ? (
            <Button variant="ghost" onClick={() => setRascunho({})}>
              Descartar
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          Os motivos de descarte também são configuráveis, e vivem na chave{' '}
          <code>motivos_descarte</code> — hoje com {data.motivos_descarte.length} opções. Como
          eles alimentam a contagem de &ldquo;por que perdemos&rdquo;, mexer neles é mexer numa
          série histórica: renomear o rótulo é seguro, trocar o <code>id</code> não.
        </p>
      </CardContent>
    </Card>
  )
}
