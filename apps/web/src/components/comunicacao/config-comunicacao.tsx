'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, Check, Mail, MessageCircle, Power, ShieldAlert } from 'lucide-react'
import {
  CONFIG_COMUNICACAO_PADRAO,
  TIPO_CONTA_DESCRICOES,
  TIPO_CONTA_LABELS,
  type ConfigComunicacao,
  type TipoContaWhatsapp,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { alternarKillSwitchAction, desconectarGmailAction, salvarConfigAction } from '@/actions/comunicacao'
import { buscarConfig, buscarContasWhatsapp, buscarMeuGmail } from './queries'
import { dataHora } from './format'

/**
 * Configurações da Comunicação (§10).
 *
 * ── O KILL SWITCH VEM PRIMEIRO ─────────────────────────────────────────────
 * É a única coisa nesta tela que alguém aperta com pressa, e o motivo pelo qual
 * ela seria aberta às 23h. Enterrá-lo abaixo da janela de envio faria alguém
 * rolar procurando enquanto o agente continua respondendo.
 *
 * ── A CONEXÃO DO GMAIL É SUA, E A TELA DIZ O QUE ELA LÊ ────────────────────
 * O filtro de ingestão (só contatos conhecidos e domínios da base) está escrito
 * aqui, ao lado do botão de conectar. Uma pessoa que autoriza acesso à própria
 * caixa precisa ler isso antes, não no README.
 */
export function ConfigComunicacaoTela({ ehAdmin }: { ehAdmin: boolean }) {
  const qc = useQueryClient()
  const params = useSearchParams()
  const config = useQuery({ queryKey: ['comunicacao', 'config'], queryFn: buscarConfig })
  const contas = useQuery({ queryKey: ['comunicacao', 'contas-whatsapp'], queryFn: buscarContasWhatsapp })
  const gmail = useQuery({ queryKey: ['comunicacao', 'gmail'], queryFn: buscarMeuGmail })

  React.useEffect(() => {
    const estado = params.get('gmail')
    if (estado === 'conectado') toast.success('Gmail conectado.')
    if (estado === 'erro') toast.error('Não foi possível conectar o Gmail. Tente de novo.')
    if (estado === 'sem_config') toast.error('A integração com o Gmail não está configurada.')
  }, [params])

  if (config.isLoading) return <Skeleton className="h-96" />

  const cfg = mesclar(config.data ?? {})

  return (
    <div className="space-y-6">
      {/* ─── Kill switch ─────────────────────────────────────────────────── */}
      <Card className={cfg.agente.kill_switch ? 'border-destructive' : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Kill switch do agente
          </CardTitle>
          <CardDescription>
            Para TODOS os modos autônomos, de uma vez. As sugestões continuam sendo geradas — elas
            não saem da casa, e desligar o copiloto junto com o piloto tiraria a ferramenta de quem
            está trabalhando.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {cfg.agente.kill_switch ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Envios autônomos DESLIGADOS
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Check className="h-3 w-3" aria-hidden />
              Agente operando normalmente
            </Badge>
          )}
          <Button
            size="sm"
            variant={cfg.agente.kill_switch ? 'default' : 'destructive'}
            disabled={!ehAdmin}
            onClick={async () => {
              const r = await alternarKillSwitchAction(!cfg.agente.kill_switch)
              if (!r.ok) {
                toast.error(r.message)
                return
              }
              await qc.invalidateQueries({ queryKey: ['comunicacao', 'config'] })
            }}
          >
            <Power className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {cfg.agente.kill_switch ? 'Religar o agente' : 'Desligar tudo agora'}
          </Button>
          {!ehAdmin ? (
            <span className="text-xs text-muted-foreground">Só administradores podem alterar.</span>
          ) : null}
        </CardContent>
      </Card>

      {/* ─── Janela e ritmo ──────────────────────────────────────────────── */}
      <JanelaERitmo cfg={cfg} ehAdmin={ehAdmin} onSalvo={() => qc.invalidateQueries({ queryKey: ['comunicacao', 'config'] })} />

      {/* ─── Gmail ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" aria-hidden />
            Seu Gmail
          </CardTitle>
          <CardDescription>
            Conectar faz o e-mail sair COMO VOCÊ e entrar na mesma thread que o cliente já tinha
            aberto. <strong>Só entram no sistema</strong> as mensagens cujo remetente ou
            destinatário for um contato conhecido ou o domínio de uma empresa da base — nunca a
            caixa inteira.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {gmail.data?.ativo ? (
            <>
              <p className="text-sm">
                Conectado como <strong>{gmail.data.endereco}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                Último sync: {dataHora(gmail.data.ultimo_sync_em)}
                {gmail.data.watch_expira_em
                  ? ` · aviso automático até ${dataHora(gmail.data.watch_expira_em)}`
                  : ' · sem aviso automático (só varredura)'}
              </p>
              {gmail.data.ultimo_erro ? (
                <p className="text-xs text-destructive">
                  Última falha: {gmail.data.ultimo_erro}. Reconecte para renovar a autorização.
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <a href="/api/auth/gmail/iniciar">Reconectar</a>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const r = await desconectarGmailAction()
                    if (!r.ok) {
                      toast.error(r.message)
                      return
                    }
                    await qc.invalidateQueries({ queryKey: ['comunicacao', 'gmail'] })
                  }}
                >
                  Desconectar
                </Button>
              </div>
            </>
          ) : (
            <Button size="sm" asChild>
              <a href="/api/auth/gmail/iniciar">Conectar meu Gmail</a>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ─── Contas de WhatsApp ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4" aria-hidden />
            Números de WhatsApp
          </CardTitle>
          <CardDescription>
            O número da IA nunca é o de relacionamento humano, e o do plantão interno não passa por
            warmup, supressão, janela nem teto. O token de cada conta vive no Vault e não é legível
            por esta tela.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(contas.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta cadastrada. O cadastro é feito em Antecipação → Configurações.
            </p>
          ) : (
            <ul className="space-y-2">
              {(contas.data ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {c.apelido} <span className="text-muted-foreground">{c.numero}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {TIPO_CONTA_DESCRICOES[c.tipo as TipoContaWhatsapp] ?? c.tipo}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="outline" className="h-5 text-[10px]">
                      {TIPO_CONTA_LABELS[c.tipo as TipoContaWhatsapp] ?? c.tipo}
                    </Badge>
                    <span className="text-muted-foreground">
                      até {c.mensagens_por_dia}/dia · {c.intervalo_min_seg}–{c.intervalo_max_seg}s
                    </span>
                    {c.warmup_iniciado_em ? (
                      <Badge variant="secondary" className="h-5 text-[10px]">
                        em warmup
                      </Badge>
                    ) : null}
                    {!c.token_definido_em ? (
                      <Badge variant="destructive" className="h-5 text-[10px]">
                        sem token
                      </Badge>
                    ) : null}
                    {!c.ativo ? (
                      <Badge variant="secondary" className="h-5 text-[10px]">
                        inativa
                      </Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function JanelaERitmo({
  cfg,
  ehAdmin,
  onSalvo,
}: {
  cfg: ConfigComunicacao
  ehAdmin: boolean
  onSalvo: () => void
}) {
  const [inicio, setInicio] = React.useState(String(cfg.janela.hora_inicio))
  const [fim, setFim] = React.useState(String(cfg.janela.hora_fim))
  const [cooldown, setCooldown] = React.useState(String(cfg.cooldown_dias))
  const [tetoThread, setTetoThread] = React.useState(String(cfg.teto_diario_por_thread))
  const [confianca, setConfianca] = React.useState(String(cfg.agente.confianca_minima))
  const [salvando, setSalvando] = React.useState(false)

  async function salvar() {
    setSalvando(true)
    try {
      const r = await salvarConfigAction({
        janela: { ...cfg.janela, hora_inicio: Number(inicio), hora_fim: Number(fim) },
        cooldown_dias: Number(cooldown),
        teto_diario_por_thread: Number(tetoThread),
        agente: { ...cfg.agente, confianca_minima: Number(confianca) },
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Configuração salva.')
      onSalvo()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Janela de envio e ritmo</CardTitle>
        <CardDescription>
          Mensagem gerada fora da janela é <strong>agendada</strong> para a próxima abertura, nunca
          descartada. Um envio manual pode furar a janela com confirmação explícita — supressão,
          não.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs">Abre às</Label>
            <Input type="number" min={0} max={23} value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-9" disabled={!ehAdmin} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fecha às</Label>
            <Input type="number" min={1} max={24} value={fim} onChange={(e) => setFim(e.target.value)} className="h-9" disabled={!ehAdmin} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cooldown (dias)</Label>
            <Input type="number" min={0} max={90} value={cooldown} onChange={(e) => setCooldown(e.target.value)} className="h-9" disabled={!ehAdmin} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Teto por conversa/dia</Label>
            <Input type="number" min={0} max={20} value={tetoThread} onChange={(e) => setTetoThread(e.target.value)} className="h-9" disabled={!ehAdmin} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Confiança mínima do agente</Label>
            <Input type="number" min={0} max={1} step={0.05} value={confianca} onChange={(e) => setConfianca(e.target.value)} className="h-9" disabled={!ehAdmin} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Abaixo da confiança mínima, a decisão do agente é descartada e a cadência fixa do playbook
          assume — nunca ficar sem próximo passo é mais importante que acertar sempre.
        </p>
        <Button size="sm" onClick={salvar} disabled={!ehAdmin || salvando}>
          Salvar
        </Button>
      </CardContent>
    </Card>
  )
}

/** Config do banco por cima do padrão de fábrica, chave a chave. */
function mesclar(bruto: Record<string, unknown>): ConfigComunicacao {
  const p = CONFIG_COMUNICACAO_PADRAO
  return {
    janela: { ...p.janela, ...(bruto.janela as object | undefined) },
    cooldown_dias: Number(bruto.cooldown_dias ?? p.cooldown_dias),
    teto_diario_por_thread: Number(bruto.teto_diario_por_thread ?? p.teto_diario_por_thread),
    warmup: { ...p.warmup, ...(bruto.warmup as object | undefined) },
    inatividade_horas: Number(bruto.inatividade_horas ?? p.inatividade_horas),
    agente: { ...p.agente, ...(bruto.agente as object | undefined) },
    plantao: { ...p.plantao, ...(bruto.plantao as object | undefined) },
  }
}
