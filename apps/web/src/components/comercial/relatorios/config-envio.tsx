'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Plus, Send, Trash2 } from 'lucide-react'
import { enviarTesteAction, salvarConfigReportAction } from '@/actions/relatorios'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { buscarConfigReport, relatoriosKeys, type DestinatarioReport } from './queries'

/**
 * Configuração de envio (04q §5).
 *
 * ─── O HORÁRIO É INFORMATIVO, E A TELA DIZ ISSO ─────────────────────────────
 * Os DIAS são obedecidos: o cron acorda todo dia e a rota lê `dias_semana` para decidir.
 * O HORÁRIO não — ele está no cron da Vercel, que é fixo. Deixar um campo de hora que
 * parece mandar e não manda é pior que não ter campo: alguém marcaria 14h, o e-mail
 * chegaria às 6h, e a conclusão seria "o sistema está quebrado".
 */

const DIAS = [
  { n: 1, curto: 'Seg' }, { n: 2, curto: 'Ter' }, { n: 3, curto: 'Qua' },
  { n: 4, curto: 'Qui' }, { n: 5, curto: 'Sex' }, { n: 6, curto: 'Sáb' }, { n: 7, curto: 'Dom' },
]

export function ConfigEnvio({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const qc = useQueryClient()
  const cfg = useQuery({
    queryKey: relatoriosKeys.config(),
    queryFn: buscarConfigReport,
    enabled: aberta,
  })

  const [destinatarios, setDestinatarios] = React.useState<DestinatarioReport[]>([])
  const [dias, setDias] = React.useState<number[]>([1])
  const [horario, setHorario] = React.useState('06:00')
  const [ativo, setAtivo] = React.useState(false)
  const [assunto, setAssunto] = React.useState('')
  const [novoEmail, setNovoEmail] = React.useState('')
  const [novoNome, setNovoNome] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const [testando, setTestando] = React.useState(false)
  const [emailTeste, setEmailTeste] = React.useState('')

  React.useEffect(() => {
    if (!cfg.data) return
    setDestinatarios(cfg.data.destinatarios)
    setDias(cfg.data.dias_semana)
    setHorario(cfg.data.horario.slice(0, 5))
    setAtivo(cfg.data.ativo)
    setAssunto(cfg.data.assunto_template ?? '')
  }, [cfg.data])

  function adicionar() {
    const email = novoEmail.trim().toLowerCase()
    if (!email) return
    if (destinatarios.some((d) => d.email.toLowerCase() === email)) {
      return toast.error('Este e-mail já está na lista.')
    }
    setDestinatarios((a) => [...a, { email, nome: novoNome.trim() || undefined }])
    setNovoEmail('')
    setNovoNome('')
  }

  async function salvar() {
    setSalvando(true)
    const r = await salvarConfigReportAction({
      destinatarios, dias_semana: dias, horario, ativo,
      assunto_template: assunto.trim() || null,
    })
    setSalvando(false)
    if (!r.ok) return toast.error(r.message)
    toast.success('Configuração salva.')
    void qc.invalidateQueries({ queryKey: relatoriosKeys.config() })
    onFechar()
  }

  async function enviarTeste() {
    const email = emailTeste.trim()
    if (!email) return toast.error('Informe o e-mail do teste.')
    setTestando(true)
    const r = await enviarTesteAction(email)
    setTestando(false)
    if (!r.ok) return toast.error(r.message)
    toast.success(`Report de teste enviado para ${email}.`)
  }

  return (
    <Dialog open={aberta} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar envio</DialogTitle>
          <DialogDescription>
            Quem recebe o report semanal, e em que dias.
          </DialogDescription>
        </DialogHeader>

        {cfg.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ativo}
                onChange={(e) => setAtivo(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Envio automático ligado
            </label>

            <div className="space-y-2">
              <Label className="text-xs">Dias da semana</Label>
              <div className="flex flex-wrap gap-1.5">
                {DIAS.map((d) => (
                  <button
                    key={d.n}
                    type="button"
                    aria-pressed={dias.includes(d.n)}
                    onClick={() =>
                      setDias((a) => (a.includes(d.n) ? a.filter((x) => x !== d.n) : [...a, d.n].sort()))
                    }
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-xs transition-colors',
                      dias.includes(d.n)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {d.curto}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="horario" className="text-xs">Horário pretendido</Label>
              <Input
                id="horario"
                type="time"
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
                className="w-32"
              />
              {/* O aviso é literal de propósito: um campo que parece mandar e não manda
                  produz a conclusão errada quando o e-mail chega em outra hora. */}
              <p className="text-[11px] text-muted-foreground">
                O agendamento real roda às <strong>06:00</strong> de Brasília. Este campo registra
                a intenção; mudar a hora de fato exige alterar o cron no deploy.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="assunto" className="text-xs">Assunto</Label>
              <Input
                id="assunto"
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
                placeholder="Report semanal ONE OS — semana {semana}, {periodo}"
              />
              <p className="text-[11px] text-muted-foreground">
                Marcadores: <code>{'{semana}'}</code>, <code>{'{periodo}'}</code>, <code>{'{ano}'}</code>.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Destinatários</Label>
              {destinatarios.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Nenhum destinatário. Com a lista vazia, o report é gerado e guardado, mas não sai.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {destinatarios.map((d) => (
                    <li key={d.email} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{d.nome || d.email}</p>
                        {d.nome ? <p className="truncate text-[11px] text-muted-foreground">{d.email}</p> : null}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remover ${d.email}`}
                        onClick={() => setDestinatarios((a) => a.filter((x) => x.email !== d.email))}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Input
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), adicionar())}
                  placeholder="email@empresa.com"
                  type="email"
                  className="min-w-[12rem] flex-1"
                />
                <Input
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Nome (opcional)"
                  className="min-w-[8rem] flex-1"
                />
                <Button size="sm" variant="outline" onClick={adicionar}>
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Adicionar
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-dashed p-3">
              <Label htmlFor="teste" className="text-xs">Enviar teste agora</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="teste"
                  value={emailTeste}
                  onChange={(e) => setEmailTeste(e.target.value)}
                  placeholder="seu@email.com"
                  type="email"
                  className="min-w-[12rem] flex-1"
                />
                <Button size="sm" variant="outline" onClick={() => void enviarTeste()} disabled={testando}>
                  {testando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                  Enviar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Gera o report da semana fechada e manda só para este endereço, com o mesmo PDF e
                o mesmo corpo que a lista receberia.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
              <Button onClick={() => void salvar()} disabled={salvando}>
                {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Salvar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
