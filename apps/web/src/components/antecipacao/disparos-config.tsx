'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, EyeOff, Mail, MessageCircle, Save } from 'lucide-react'
import { FAIXAS, FAIXA_LABELS, formatarMoeda, renderizarTemplate, type Faixa } from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { salvarFaixaDisparoAction } from '@/actions/antecipacao'
import { cn } from '@/lib/utils'
import { FAIXA_BADGE } from './format'
import { antecipacaoKeys, buscarContasWhatsapp, buscarDisparos } from './queries'

/**
 * A régua de disparo por faixa (§6) — em MODO SOMBRA.
 *
 * Ligar um canal aqui NÃO liga envio. Ele liga a GERAÇÃO da fila: o job passa a
 * produzir, para aquela faixa, exatamente a mensagem que sairia, com o
 * destinatário que seria escolhido, e a deixa na Outbox com status
 * `pendente_envio`. É de propósito que a validação venha antes do canal: ligar
 * canais primeiro e conferir depois é como se queima uma base de contatos.
 *
 * O aviso no topo existe porque um toggle chamado "E-mail habilitado" parece
 * fazer outra coisa. Ele não pode ser sutil.
 */

const PLACEHOLDERS = [
  '{fornecedor_nome}',
  '{qtd_notas}',
  '{valor_total}',
  '{sacado_principal}',
  '{receita_estimada_fornecedor}',
] as const

const EXEMPLO = {
  fornecedor_nome: 'CONSTRUTORA EXEMPLO LTDA',
  qtd_notas: '3',
  valor_total: formatarMoeda(184_500),
  sacado_principal: 'INCORPORADORA MODELO S/A',
  receita_estimada_fornecedor: formatarMoeda(3_690),
}

function PainelDisparo({
  faixa,
  contas,
}: {
  faixa: Faixa
  contas: { id: string; apelido: string; numero: string; ativo: boolean }[]
}) {
  const qc = useQueryClient()
  const { data, isPending } = useQuery({
    queryKey: antecipacaoKeys.disparos(),
    queryFn: buscarDisparos,
  })

  const atual = (data ?? []).find((d) => d.faixa === faixa)
  const [rascunho, setRascunho] = React.useState<Record<string, unknown> | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    setRascunho(null)
  }, [faixa])

  const valores = {
    email_habilitado: atual?.email_habilitado ?? false,
    whatsapp_habilitado: atual?.whatsapp_habilitado ?? false,
    whatsapp_contas: atual?.whatsapp_contas ?? [],
    cooldown_dias: atual?.cooldown_dias ?? 7,
    assunto_email: atual?.assunto_email ?? '',
    template_email: atual?.template_email ?? '',
    template_whatsapp: atual?.template_whatsapp ?? '',
    ...(rascunho ?? {}),
  } as {
    email_habilitado: boolean
    whatsapp_habilitado: boolean
    whatsapp_contas: string[]
    cooldown_dias: number
    assunto_email: string
    template_email: string
    template_whatsapp: string
  }

  function alterar<K extends keyof typeof valores>(chave: K, valor: (typeof valores)[K]) {
    setRascunho((r) => ({ ...(r ?? {}), [chave]: valor }))
  }

  async function salvar() {
    setSalvando(true)
    const r = await salvarFaixaDisparoAction({ faixa, ...valores })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Régua salva. A fila-sombra está sendo regenerada com os critérios novos.')
    setRascunho(null)
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
  }

  if (isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={FAIXA_BADGE[faixa]}>{FAIXA_LABELS[faixa]}</Badge>
          <CardTitle className="text-base">Régua de disparo</CardTitle>
        </div>
        <CardDescription>
          Canais, cooldown e templates desta faixa. Nada é enviado nesta fase — o resultado vai para
          a Outbox.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ─── Canais ───────────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor={`email-${faixa}`} className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
              Gerar e-mail
            </Label>
            <Switch
              id={`email-${faixa}`}
              checked={valores.email_habilitado}
              onCheckedChange={(v) => alterar('email_habilitado', v)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor={`wa-${faixa}`} className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
              Gerar WhatsApp
            </Label>
            <Switch
              id={`wa-${faixa}`}
              checked={valores.whatsapp_habilitado}
              onCheckedChange={(v) => alterar('whatsapp_habilitado', v)}
            />
          </div>
        </div>

        {valores.whatsapp_habilitado && (
          <div className="space-y-2">
            <Label>Contas de WhatsApp (round-robin)</Label>
            {contas.length === 0 ? (
              <p className={cn('rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.warning)}>
                Nenhuma conta cadastrada. Cadastre em &quot;Contas WhatsApp&quot; — sem conta, as
                mensagens de WhatsApp ficam sem número de origem.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {contas.map((c) => {
                  const marcada = valores.whatsapp_contas.includes(c.id)
                  return (
                    <Button
                      key={c.id}
                      type="button"
                      size="sm"
                      variant={marcada ? 'default' : 'outline'}
                      aria-pressed={marcada}
                      disabled={!c.ativo}
                      onClick={() =>
                        alterar(
                          'whatsapp_contas',
                          marcada
                            ? valores.whatsapp_contas.filter((id) => id !== c.id)
                            : [...valores.whatsapp_contas, c.id],
                        )
                      }
                    >
                      {c.apelido}
                      {!c.ativo && ' (inativa)'}
                    </Button>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              O volume é distribuído entre as contas marcadas. Distribuir é o que evita queimar um
              único número quando os envios ligarem.
            </p>
          </div>
        )}

        <Separator />

        {/* ─── Cooldown ─────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label htmlFor={`cooldown-${faixa}`}>Cooldown (dias)</Label>
          <Input
            id={`cooldown-${faixa}`}
            type="number"
            min={0}
            max={365}
            className="max-w-[8rem]"
            value={valores.cooldown_dias}
            onChange={(e) => alterar('cooldown_dias', Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Mínimo entre dois toques ao MESMO fornecedor. Conta também o toque manual do vendedor
            (ligação, WhatsApp ou e-mail pelo app), para que a régua não atropele quem acabou de
            falar com a pessoa.
          </p>
        </div>

        <Separator />

        {/* ─── Templates ────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Variáveis:</span>
            {PLACEHOLDERS.map((p) => (
              <code key={p} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {p}
              </code>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`assunto-${faixa}`}>Assunto do e-mail</Label>
            <Input
              id={`assunto-${faixa}`}
              value={valores.assunto_email}
              onChange={(e) => alterar('assunto_email', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`corpo-email-${faixa}`}>Corpo do e-mail</Label>
            <Textarea
              id={`corpo-email-${faixa}`}
              rows={8}
              value={valores.template_email}
              onChange={(e) => alterar('template_email', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`corpo-wa-${faixa}`}>Mensagem de WhatsApp</Label>
            <Textarea
              id={`corpo-wa-${faixa}`}
              rows={4}
              value={valores.template_whatsapp}
              onChange={(e) => alterar('template_whatsapp', e.target.value)}
            />
          </div>

          {/* A prévia usa o MESMO renderizador do job (packages/core). Duas
              implementações dariam duas mensagens: a testada e a enviada. */}
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Prévia com dados de exemplo
            </p>
            <p className="text-sm font-medium">
              {renderizarTemplate(valores.assunto_email, EXEMPLO) || '(sem assunto)'}
            </p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {renderizarTemplate(valores.template_email, EXEMPLO) || '(sem corpo)'}
            </p>
            <Separator />
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {renderizarTemplate(valores.template_whatsapp, EXEMPLO) || '(sem mensagem)'}
            </p>
          </div>
        </div>

        <Button onClick={() => void salvar()} disabled={salvando || rascunho === null}>
          <Save className="mr-2 h-4 w-4" aria-hidden />
          {salvando ? 'Salvando…' : 'Salvar régua'}
        </Button>
      </CardContent>
    </Card>
  )
}

export function DisparosConfig() {
  const [faixa, setFaixa] = React.useState<Faixa>('alta')
  const { data: contas } = useQuery({
    queryKey: antecipacaoKeys.contas(),
    queryFn: buscarContasWhatsapp,
  })

  return (
    <div className="space-y-4">
      <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.info)}>
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Modo sombra: nada é enviado</p>
          <p>
            Ligar um canal aqui liga a GERAÇÃO da fila, não o envio. O job produz a mensagem exata
            que sairia, com o destinatário que seria escolhido, e a deixa na Outbox como
            &quot;pendente de envio&quot;. Os canais de verdade entram no próximo prompt.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {FAIXAS.map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={faixa === f ? 'default' : 'outline'}
            aria-pressed={faixa === f}
            onClick={() => setFaixa(f)}
          >
            {FAIXA_LABELS[f]}
          </Button>
        ))}
      </div>

      <PainelDisparo
        faixa={faixa}
        contas={(contas ?? []).map((c) => ({
          id: c.id,
          apelido: c.apelido,
          numero: c.numero,
          ativo: c.ativo,
        }))}
      />

      {(contas ?? []).length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Sem contas de WhatsApp cadastradas, apenas o canal de e-mail produz mensagem completa.
        </p>
      )}
    </div>
  )
}
