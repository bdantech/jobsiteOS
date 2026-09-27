'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ExternalLink, Plus } from 'lucide-react'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { salvarCaixaEmailAction } from '@/actions/agentes-gestao'
import { cn } from '@/lib/utils'
import { dataHora } from './gestao-format'
import { gestaoAgentesKeys, type AgenteIa, type CaixaEmail } from './queries-gestao'

/**
 * A CAIXA DE E-MAIL DA PERSONA (§4.2).
 *
 * A recomendação da spec é uma caixa REAL no Google Workspace (`ana@oneos.com.br`), lida e
 * escrita pela Gmail API com a mesma integração OAuth dos vendedores humanos: a resposta
 * do cliente cai numa caixa que existe, um humano pode abrir e ver, e o histórico não
 * depende de webhook. `resend` é só saída — serve de remetente, mas o agente não LÊ a
 * resposta por ela.
 *
 * Cadastrar a caixa não a conecta: a conexão é o OAuth do Google, feito por um gestor que
 * consegue entrar naquela conta. Até lá, a caixa aparece como "não conectada" com o botão
 * — e o erro do último sync, quando houver, fica visível aqui em vez de num log.
 */

export const NENHUM = '__nenhum__'

export function CaixaEmailCampo({
  caixas,
  agentes,
  agenteId,
  valor,
  onChange,
}: {
  caixas: CaixaEmail[]
  agentes: AgenteIa[]
  agenteId: string | null
  valor: string | null
  onChange: (id: string | null) => void
}) {
  const qc = useQueryClient()
  const [criando, setCriando] = React.useState(false)
  const [endereco, setEndereco] = React.useState('')
  const [provedor, setProvedor] = React.useState<'google_workspace' | 'resend'>('google_workspace')
  const [salvando, setSalvando] = React.useState(false)

  const selecionada = caixas.find((c) => c.id === valor) ?? null
  const usoPor = (id: string) =>
    agentes.filter((a) => a.email_caixa_id === id && a.id !== agenteId && a.ativo).map((a) => a.nome)

  async function criar() {
    setSalvando(true)
    const r = await salvarCaixaEmailAction({ endereco: endereco.trim().toLowerCase(), provedor, ativa: true })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      provedor === 'google_workspace'
        ? 'Caixa cadastrada. Falta conectar com o Google para o agente ler as respostas.'
        : 'Caixa cadastrada.',
    )
    await qc.invalidateQueries({ queryKey: gestaoAgentesKeys.caixas() })
    onChange(r.data.id)
    setCriando(false)
    setEndereco('')
  }

  return (
    <div className="space-y-2">
      <Label>Caixa de e-mail</Label>
      <Select value={valor ?? NENHUM} onValueChange={(v) => onChange(v === NENHUM ? null : v)}>
        <SelectTrigger>
          <SelectValue placeholder="Sem caixa própria" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NENHUM}>Sem caixa própria</SelectItem>
          {caixas.map((c) => {
            const outros = usoPor(c.id)
            return (
              <SelectItem key={c.id} value={c.id} disabled={!c.ativa}>
                {c.endereco} · {c.provedor === 'google_workspace' ? 'Google Workspace' : 'Resend'}
                {!c.ativa ? ' (inativa)' : ''}
                {outros.length > 0 ? ` — também de ${outros.join(', ')}` : ''}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      {caixas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma caixa cadastrada. Sem caixa, o agente só manda e-mail pelo remetente do Resend
          abaixo — e não lê as respostas.
        </p>
      ) : null}

      {selecionada ? <StatusCaixa caixa={selecionada} /> : null}

      {criando ? (
        <div className="space-y-2 rounded-md border p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
            <Input
              type="email"
              placeholder="ana@oneos.com.br"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              aria-label="Endereço da caixa"
            />
            <Select value={provedor} onValueChange={(v) => setProvedor(v as 'google_workspace' | 'resend')}>
              <SelectTrigger aria-label="Provedor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="google_workspace">Google Workspace</SelectItem>
                <SelectItem value="resend">Resend (só saída)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={salvando || !endereco.includes('@')} onClick={() => void criar()}>
              {salvando ? 'Salvando…' : 'Cadastrar caixa'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCriando(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setCriando(true)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Nova caixa
        </Button>
      )}
    </div>
  )
}

function StatusCaixa({ caixa }: { caixa: CaixaEmail }) {
  const google = caixa.provedor === 'google_workspace'
  return (
    <div className="space-y-2 rounded-md border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {google ? (
          caixa.conectada_em ? (
            <Badge variant="success">
              <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> Conectada em {dataHora(caixa.conectada_em)}
            </Badge>
          ) : (
            <Badge variant="warning">Não conectada</Badge>
          )
        ) : (
          <Badge variant="neutral">Resend: só saída</Badge>
        )}
        {caixa.ultimo_sync_em ? (
          <span className="text-muted-foreground">Último sync {dataHora(caixa.ultimo_sync_em)}</span>
        ) : null}
        {google && !caixa.conectada_em ? (
          <Button asChild size="sm" variant="outline" className="h-7">
            <a href={`/api/auth/gmail/iniciar?caixa=${encodeURIComponent(caixa.id)}`}>
              Conectar Google <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
            </a>
          </Button>
        ) : null}
      </div>
      {google && !caixa.conectada_em ? (
        <p className="text-muted-foreground">
          Entre com a conta {caixa.endereco} no Google. Até conectar, o agente não lê as respostas
          que chegam nesta caixa.
        </p>
      ) : null}
      {caixa.ultimo_erro ? (
        <p className={cn('flex items-start gap-1.5 rounded border p-1.5', STATUS_SUPERFICIE.critical)}>
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Último erro: {caixa.ultimo_erro}
        </p>
      ) : null}
    </div>
  )
}
