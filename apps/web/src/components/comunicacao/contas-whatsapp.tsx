'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Plus, ShieldCheck, TriangleAlert } from 'lucide-react'
import {
  TIPOS_CONTA_WHATSAPP,
  TIPO_CONTA_DESCRICOES,
  TIPO_CONTA_LABELS,
  type TipoContaWhatsapp,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { salvarWhatsappContaAction } from '@/actions/antecipacao'
import { cn } from '@/lib/utils'
import { dataHora, telefoneLegivel } from './format'
import { buscarContasWhatsapp, type ContaWhatsappLida } from './queries'

/**
 * Contas de WhatsApp. Vive na Comunicação porque é aqui que o número significa
 * alguma coisa — na Antecipação ele era só um remetente.
 *
 * O TOKEN NUNCA VOLTA. Ele vai para o Supabase Vault e a tabela guarda apenas um
 * ponteiro, cuja coluna não tem grant de select para `authenticated` (0052). A UI
 * mostra "definido em {data}" e um botão de substituir — não há caminho de
 * leitura, nem por PostgREST direto. Um campo que reexibe o token é um token que
 * vaza no primeiro compartilhamento de tela.
 *
 * Os quatro campos abaixo do token não são preferências: são o que decide se o
 * número sobrevive ao primeiro mês. `tipo` escolhe quem envia por ele (§1.3),
 * `warmup_iniciado_em` é o que segura a rampa, e o par de intervalos é o que
 * impede a cadência perfeitamente regular que denuncia um robô.
 */

const CHAVE_CONTAS = ['comunicacao', 'contas-whatsapp'] as const

/** `<input type="date">` fala AAAA-MM-DD, que é o mesmo formato da coluna `date`. */
function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function ContaDialog({
  conta,
  aberto,
  onOpenChange,
}: {
  conta: ContaWhatsappLida | null
  aberto: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [apelido, setApelido] = React.useState(conta?.apelido ?? '')
  const [numero, setNumero] = React.useState(conta?.numero ?? '')
  const [token, setToken] = React.useState('')
  const [ativo, setAtivo] = React.useState(conta?.ativo ?? true)
  const [tipo, setTipo] = React.useState<TipoContaWhatsapp>(
    (conta?.tipo as TipoContaWhatsapp | undefined) ?? 'relacionamento',
  )
  const [teto, setTeto] = React.useState(String(conta?.mensagens_por_dia ?? 200))
  const [intMin, setIntMin] = React.useState(String(conta?.intervalo_min_seg ?? 25))
  const [intMax, setIntMax] = React.useState(String(conta?.intervalo_max_seg ?? 70))
  // Número novo entra em warmup por padrão. O contrário — nascer com o teto
  // cheio — é como se queima um número no segundo dia.
  const [emWarmup, setEmWarmup] = React.useState(
    conta ? conta.warmup_iniciado_em !== null : true,
  )
  const [warmupEm, setWarmupEm] = React.useState(conta?.warmup_iniciado_em ?? hojeISO())
  const [salvando, setSalvando] = React.useState(false)

  const digitos = numero.replace(/\D/g, '')
  const numeroValido = digitos.length >= 10 && digitos.length <= 15
  const nMin = Number(intMin)
  const nMax = Number(intMax)
  const nTeto = Number(teto)
  const intervaloValido =
    Number.isInteger(nMin) && Number.isInteger(nMax) && nMin >= 0 && nMax >= nMin && nMax <= 7200
  const tetoValido = Number.isInteger(nTeto) && nTeto >= 0 && nTeto <= 2000
  const podeSalvar =
    apelido.trim() !== '' &&
    numeroValido &&
    intervaloValido &&
    tetoValido &&
    (conta !== null || token.trim().length >= 8)

  async function salvar() {
    setSalvando(true)
    const r = await salvarWhatsappContaAction({
      id: conta?.id,
      apelido: apelido.trim(),
      numero: digitos,
      token: token.trim() === '' ? undefined : token.trim(),
      ativo,
      tipo,
      mensagens_por_dia: nTeto,
      intervalo_min_seg: nMin,
      intervalo_max_seg: nMax,
      // `null` explícito, não chave ausente: desligar o warmup é uma decisão, e
      // a RPC só distingue as duas pela PRESENÇA da chave.
      warmup_iniciado_em: emWarmup ? warmupEm : null,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(conta ? 'Conta atualizada.' : 'Conta cadastrada.')
    setToken('')
    onOpenChange(false)
    void qc.invalidateQueries({ queryKey: CHAVE_CONTAS })
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{conta ? 'Editar conta' : 'Nova conta de WhatsApp'}</DialogTitle>
          <DialogDescription>
            O tipo decide quem envia por este número; o warmup e o intervalo decidem se ele continua
            existindo daqui a um mês.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apelido">Apelido</Label>
            <Input
              id="apelido"
              value={apelido}
              onChange={(e) => setApelido(e.target.value)}
              placeholder="Ex.: Comercial SP 1"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="numero">Número (DDI + DDD + número)</Label>
            <Input
              id="numero"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="5511999998888"
              inputMode="numeric"
            />
            {numero !== '' && !numeroValido && (
              <p className="text-xs text-destructive">
                Use apenas dígitos, com DDI e DDD — entre 10 e 15 dígitos.
              </p>
            )}
            {numeroValido && (
              <p className="text-xs text-muted-foreground">{telefoneLegivel(digitos)}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tipo">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoContaWhatsapp)}>
              <SelectTrigger id="tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_CONTA_WHATSAPP.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPO_CONTA_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{TIPO_CONTA_DESCRICOES[tipo]}</p>
            {tipo === 'ia' && (
              <p
                className={cn(
                  'flex items-start gap-1.5 rounded border p-2 text-xs',
                  STATUS_SUPERFICIE.warning,
                )}
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Este número passa a assinar as mensagens da persona. Se ele for o WhatsApp de alguém
                da casa, a pessoa e a IA passam a falar pela mesma janela — e quem está do outro lado
                não tem como saber com qual das duas falou.
              </p>
            )}
            {tipo === 'plantao' && (
              <p
                className={cn(
                  'flex items-start gap-1.5 rounded border p-2 text-xs',
                  STATUS_SUPERFICIE.warning,
                )}
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Transporte interno: não passa por supressão, janela, teto nem warmup. Use apenas para
                alertar o time, nunca para falar com um cliente.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="token">
              Token {conta ? '(deixe em branco para manter o atual)' : ''}
            </Label>
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="new-password"
              placeholder={conta?.token_definido_em ? '••••••••  (já definido)' : ''}
            />
            <p className="flex items-start gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Guardado cifrado no Vault. Não há como reexibi-lo depois — nem por esta tela, nem por
              consulta direta. Perdido, só substituir.
            </p>
          </div>

          {/* ─── Ritmo: o que separa um número vivo de um número banido ───── */}
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-2">
              <Label htmlFor="teto">Teto diário (mensagens)</Label>
              <Input
                id="teto"
                value={teto}
                onChange={(e) => setTeto(e.target.value)}
                inputMode="numeric"
              />
              {!tetoValido && (
                <p className="text-xs text-destructive">Informe um número entre 0 e 2000.</p>
              )}
              <p className="text-xs text-muted-foreground">
                É o teto do número maduro. Durante o warmup vale a rampa, sempre a menor das duas.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="int-min">Intervalo mín. (s)</Label>
                <Input
                  id="int-min"
                  value={intMin}
                  onChange={(e) => setIntMin(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="int-max">Intervalo máx. (s)</Label>
                <Input
                  id="int-max"
                  value={intMax}
                  onChange={(e) => setIntMax(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            {!intervaloValido ? (
              <p className="text-xs text-destructive">
                O mínimo não pode ser maior que o máximo, e o máximo vai até 7200 segundos.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                O envio sorteia um valor nesta faixa a cada mensagem. A faixa existe porque uma
                cadência perfeitamente regular é a assinatura mais óbvia de um robô.
              </p>
            )}

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <div>
                <Label htmlFor="warmup">Em warmup</Label>
                <p className="text-xs text-muted-foreground">
                  Rampa semanal a partir da data. Desligar devolve o número ao teto cheio.
                </p>
              </div>
              <Switch id="warmup" checked={emWarmup} onCheckedChange={setEmWarmup} />
            </div>
            {emWarmup && (
              <div className="space-y-2">
                <Label htmlFor="warmup-em">Warmup iniciado em</Label>
                <Input
                  id="warmup-em"
                  type="date"
                  value={warmupEm}
                  max={hojeISO()}
                  onChange={(e) => setWarmupEm(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="ativo">Conta ativa</Label>
            <Switch id="ativo" checked={ativo} onCheckedChange={setAtivo} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={!podeSalvar || salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ContasWhatsapp() {
  const [editando, setEditando] = React.useState<ContaWhatsappLida | null>(null)
  const [criando, setCriando] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: CHAVE_CONTAS,
    queryFn: buscarContasWhatsapp,
  })

  const contas = data ?? []
  const temIa = contas.some((c) => c.tipo === 'ia' && c.ativo && c.token_definido_em !== null)

  return (
    <div className="space-y-4">
      {!isPending && !isError && !temIa && (
        <div
          className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.warning)}
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Nenhum número de IA ativo</p>
            <p>
              A persona não envia nada enquanto não houver uma conta ativa do tipo{' '}
              <span className="font-medium">Persona de IA</span> com token definido. O resto da
              Comunicação funciona; só a voz da IA fica muda.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Contas de WhatsApp</CardTitle>
            <CardDescription>
              Números de origem, seus tokens e o ritmo com que cada um pode falar.
            </CardDescription>
          </div>
          <Button onClick={() => setCriando(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Nova conta
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Erro ao carregar as contas.'}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Apelido</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Ritmo</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contas.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                        Nenhuma conta cadastrada.
                      </TableCell>
                    </TableRow>
                  )}
                  {contas.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.apelido}</TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {telefoneLegivel(c.numero)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.tipo === 'ia' ? 'default' : 'outline'}>
                          {TIPO_CONTA_LABELS[c.tipo as TipoContaWhatsapp] ?? c.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        até {c.mensagens_por_dia}/dia · {c.intervalo_min_seg}–{c.intervalo_max_seg}s
                        {c.warmup_iniciado_em ? (
                          <Badge variant="secondary" className="ml-2 h-5 text-[10px]">
                            em warmup
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.token_definido_em ? (
                          `definido em ${dataHora(c.token_definido_em)}`
                        ) : (
                          <Badge variant="destructive" className="h-5 text-[10px]">
                            sem token
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.ativo ? 'secondary' : 'outline'}>
                          {c.ativo ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditando(c)}>
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {criando && <ContaDialog conta={null} aberto onOpenChange={(v) => !v && setCriando(false)} />}
      {editando && (
        <ContaDialog
          key={editando.id}
          conta={editando}
          aberto
          onOpenChange={(v) => !v && setEditando(null)}
        />
      )}
    </div>
  )
}
