'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CUSTOS_PADRAO, TEMPLATE_PADRAO, VARIAVEIS_APRESENTACAO } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { salvarConfigFornecedoresAction } from '@/actions/fornecedores'
import { buscarConfigFornecedores, fornecedoresKeys } from './queries'
import { brlExato } from './formato'

/**
 * Settings do funil de fornecedores (04l §7), dentro de Comercial → Configurações.
 *
 * O QUE NÃO ESTÁ AQUI, e é o ponto: as credenciais. Usuário, senha e cliente da Nova
 * Vida e a chave do Google Places vivem só em variável de ambiente do worker. Esta
 * tabela é lida por `authenticated` para que o card possa mostrar o custo do clique —
 * pôr uma credencial nela seria distribuí-la a todo mundo que tem o módulo. O RPC
 * recusa qualquer chave com "token" ou "senha" no nome, por garantia.
 */

const NUMEROS: { chave: string; rotulo: string; nota: string; passo?: string }[] = [
  {
    chave: 'corte_volume',
    rotulo: 'Corte de volume (R$ em 90 dias)',
    nota:
      'Quem passa disto entra no funil, sem curadoria. Medido em 25/08/2026: a R$ 50 mil a lista tem 688 fornecedores (R$ 289,2 milhões cedidos na janela); sem corte, 7.892 — que não é um funil, é a lista morta com kanban em volta.',
  },
  {
    chave: 'teto_mensal_por_originador',
    rotulo: 'Teto mensal por originador (R$)',
    nota:
      'O teto é a AUTORIZAÇÃO: dentro dele o originador aciona a busca paga sozinho. Estourado, precisa de liberação do gestor. Pedir aprovação para cada R$ 1,65 faria ninguém usar o recurso.',
  },
  {
    chave: 'orcamento_automatico_mensal',
    rotulo: 'Orçamento automático mensal (R$)',
    nota:
      'Para o que roda sem clique — hoje, só o Google Places na varredura noturna. Separado do teto do originador de propósito: ninguém autorizou individualmente uma varredura, e debitá-la do saldo de alguém faria essa pessoa descobrir o gasto no dia em que precisasse clicar.',
  },
  {
    chave: 'apollo_minimo_funcionarios',
    rotulo: 'Apollo: mínimo de funcionários',
    nota:
      'Abaixo disto o Apollo é pulado com o motivo registrado. Uma serralheria de quatro pessoas não tem página no LinkedIn, e pagar para descobrir isso 688 vezes é gasto sem retorno.',
  },
  {
    chave: 'ttl_dias_sob_demanda',
    rotulo: 'TTL das fontes pagas (dias)',
    nota: 'Dois cliques no mesmo card dentro deste prazo não pagam duas vezes pela mesma resposta.',
  },
  {
    chave: 'ttl_dias_automatica',
    rotulo: 'TTL da varredura automática (dias)',
    nota: 'De quanto em quanto tempo um fornecedor volta para a fila da camada 0+1.',
  },
  {
    chave: 'max_notas_por_extracao',
    rotulo: 'Notas lidas por extração de XML',
    nota:
      'O ganho satura rápido: o telefone do emitente é o mesmo em todas as notas, e o que cresce é só a frequência.',
  },
]

export function ConfigFornecedores() {
  const qc = useQueryClient()
  const config = useQuery({
    queryKey: fornecedoresKeys.config(),
    queryFn: buscarConfigFornecedores,
  })

  const salvar = useMutation({
    mutationFn: async (v: { chave: string; valor: unknown }) => {
      const r = await salvarConfigFornecedoresAction(v)
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('Configuração salva.')
      void qc.invalidateQueries({ queryKey: fornecedoresKeys.config() })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (config.isPending) return <Skeleton className="h-96 w-full" />

  const d = config.data ?? {}
  const custos = { ...CUSTOS_PADRAO, ...((d.custos as Record<string, number>) ?? {}) }
  const pararAlta = d.parar_ao_encontrar_alta !== false
  const template = typeof d.template_apresentacao === 'string' ? d.template_apresentacao : TEMPLATE_PADRAO

  const custoDoClique = custos.novavida + custos.apollo + custos.claude_busca

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entrada no funil e orçamento</CardTitle>
          <CardDescription>
            Toda mudança aqui vai para o audit_log. São os números que decidem quem entra na
            lista e quanto se pode gastar para achar o telefone dele.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4 text-sm">
            {NUMEROS.map((n) => (
              <CampoNumero
                key={n.chave}
                rotulo={n.rotulo}
                nota={n.nota}
                valor={Number(d[n.chave] ?? 0)}
                disabled={salvar.isPending}
                onSalvar={(v) => salvar.mutate({ chave: n.chave, valor: v })}
              />
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custo por provedor</CardTitle>
          <CardDescription>
            É este número que o botão mostra ao originador ANTES de perguntar se pode gastar, e é
            ele que o orçamento debita depois. Um clique completo custa hoje{' '}
            <strong>{brlExato(custoDoClique)}</strong> no teto — menos, quando a cascata para
            antes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-4 text-sm">
            <CampoDecimal
              rotulo="Google Places (R$/consulta)"
              nota="Único item pago da camada automática. Cobra por consulta, não por resultado."
              valor={custos.google_places}
              disabled={salvar.isPending}
              onSalvar={(v) => salvar.mutate({ chave: 'custos', valor: { ...custos, google_places: v } })}
            />
            <CampoDecimal
              rotulo="Nova Vida TI (R$/consulta)"
              nota="Sócios enriquecidos. Primeira etapa paga porque em PME de construção o sócio quase sempre É quem decide."
              valor={custos.novavida}
              disabled={salvar.isPending}
              onSalvar={(v) => salvar.mutate({ chave: 'custos', valor: { ...custos, novavida: v } })}
            />
            <CampoDecimal
              rotulo="Apollo (R$/revelação)"
              nota="Mantenha igual ao custo do Radar: é a mesma cobrança, e dois valores fariam os dois orçamentos divergirem sobre a mesma fatura."
              valor={custos.apollo}
              disabled={salvar.isPending}
              onSalvar={(v) => salvar.mutate({ chave: 'custos', valor: { ...custos, apollo: v } })}
            />
            <CampoDecimal
              rotulo="Busca do Claude (R$/consulta)"
              nota="Primeira passada, ampla: é ela que alcança a PME que só existe no Instagram — e é ela que descobre o domínio que o Apollo precisa."
              valor={custos.claude_busca}
              disabled={salvar.isPending}
              onSalvar={(v) => salvar.mutate({ chave: 'custos', valor: { ...custos, claude_busca: v } })}
            />
            <CampoDecimal
              rotulo="Busca aprofundada (R$/consulta)"
              nota="Segunda passada, sob demanda: recebe o que já foi achado e o que falhou na validação, e procura a lacuna em sindicato, junta comercial e notícia local. Mais cara porque vasculha mais."
              valor={custos.claude_aprofundado}
              disabled={salvar.isPending}
              onSalvar={(v) =>
                salvar.mutate({ chave: 'custos', valor: { ...custos, claude_aprofundado: v } })
              }
            />
          </dl>

          <label className="flex items-start justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Parar ao encontrar contato de confiança alta
              <span className="block text-xs">
                Ligado, a cascata para na primeira fonte que devolve alta e o clique custa menos
                que o estimado. Desligado, ela roda inteira sempre — útil só para medir cobertura
                de provedor.
              </span>
            </span>
            <input
              type="checkbox"
              checked={pararAlta}
              disabled={salvar.isPending}
              onChange={(e) => salvar.mutate({ chave: 'parar_ao_encontrar_alta', valor: e.target.checked })}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Template do pedido de apresentação</CardTitle>
          <CardDescription>
            O padrão NÃO cita o volume que o fornecedor fatura contra o sacado: o número vem das
            notas que o próprio sacado nos enviou, e devolvê-lo na mensagem soa como vigilância
            mesmo sendo um dado que ele nos deu. As variáveis existem para quem quiser adaptar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <CampoTemplate
            valor={template}
            disabled={salvar.isPending}
            onSalvar={(v) => salvar.mutate({ chave: 'template_apresentacao', valor: v })}
          />
          <p className="text-xs text-muted-foreground">
            Variáveis: {VARIAVEIS_APRESENTACAO.map((v) => `{{${v}}}`).join(' · ')}
          </p>
          <p className="text-xs text-muted-foreground">
            Uma variável escrita errado fica visível com as chaves na mensagem, em vez de virar um
            buraco em branco — o erro precisa aparecer antes de o texto ser copiado.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function CampoNumero({
  rotulo, nota, valor, onSalvar, disabled,
}: {
  rotulo: string
  nota: string
  valor: number
  onSalvar: (n: number) => void
  disabled?: boolean
}) {
  const [texto, setTexto] = React.useState(String(valor))
  React.useEffect(() => setTexto(String(valor)), [valor])
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">
        {rotulo}
        <span className="block text-xs">{nota}</span>
      </dt>
      <dd>
        <Input
          aria-label={rotulo}
          type="number"
          min={0}
          value={texto}
          disabled={disabled}
          onChange={(e) => setTexto(e.target.value)}
          // Salva no BLUR: por tecla, "5", "50" e "500" iriam todos ao banco, e o job
          // pegaria o número do meio se rodasse no instante errado.
          onBlur={() => {
            const n = Number(texto)
            if (!Number.isFinite(n) || n < 0) return setTexto(String(valor))
            if (n !== valor) onSalvar(n)
          }}
          className="h-8 w-28 text-right tabular-nums"
        />
      </dd>
    </div>
  )
}

function CampoDecimal({
  rotulo, nota, valor, onSalvar, disabled,
}: {
  rotulo: string
  nota: string
  valor: number
  onSalvar: (n: number) => void
  disabled?: boolean
}) {
  const [texto, setTexto] = React.useState(String(valor))
  React.useEffect(() => setTexto(String(valor)), [valor])
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">
        {rotulo}
        <span className="block text-xs">{nota}</span>
      </dt>
      <dd>
        <Input
          aria-label={rotulo}
          type="number"
          min={0}
          step="0.01"
          value={texto}
          disabled={disabled}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => {
            const n = Number(texto)
            if (!Number.isFinite(n) || n < 0) return setTexto(String(valor))
            if (n !== valor) onSalvar(n)
          }}
          className="h-8 w-28 text-right tabular-nums"
        />
      </dd>
    </div>
  )
}

function CampoTemplate({
  valor, onSalvar, disabled,
}: {
  valor: string
  onSalvar: (s: string) => void
  disabled?: boolean
}) {
  const [texto, setTexto] = React.useState(valor)
  React.useEffect(() => setTexto(valor), [valor])
  const mudou = texto !== valor
  return (
    <div className="space-y-2">
      <Label htmlFor="template-apresentacao" className="sr-only">Template</Label>
      <Textarea
        id="template-apresentacao"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={12}
        disabled={disabled}
        className="font-mono text-xs"
      />
      <Button size="sm" disabled={!mudou || disabled} onClick={() => onSalvar(texto)}>
        Salvar template
      </Button>
    </div>
  )
}
