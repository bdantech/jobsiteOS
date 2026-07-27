'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, KeyRound, Plus, ShieldCheck } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { salvarWhatsappContaAction } from '@/actions/antecipacao'
import { cn } from '@/lib/utils'
import { formatarData } from './format'
import { antecipacaoKeys, buscarContasWhatsapp, type WhatsappConta } from './queries'

/**
 * Cadastro de contas de WhatsApp (webOnly, §6). Integração real no Prompt 05 —
 * aqui é só o cadastro.
 *
 * O TOKEN NUNCA VOLTA. Ele vai para o Supabase Vault e a tabela guarda apenas um
 * ponteiro, cuja coluna nem tem grant de select para `authenticated` (0046). A UI
 * mostra "definido em {data}" e um botão de substituir — não há caminho de leitura,
 * nem por PostgREST direto. Isso é intencional: um campo que reexibe o token é um
 * token que vaza no primeiro compartilhamento de tela.
 */

function formatarNumero(numero: string): string {
  // 5511999998888 → +55 (11) 99999-8888. Números fora do padrão BR ficam como estão.
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(numero)
  if (!m) return `+${numero}`
  return `+55 (${m[1]}) ${m[2]}-${m[3]}`
}

function ContaDialog({
  conta,
  aberto,
  onOpenChange,
}: {
  conta: WhatsappConta | null
  aberto: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [apelido, setApelido] = React.useState(conta?.apelido ?? '')
  const [numero, setNumero] = React.useState(conta?.numero ?? '')
  const [provedor, setProvedor] = React.useState(conta?.provedor ?? 'wasender')
  const [token, setToken] = React.useState('')
  const [ativo, setAtivo] = React.useState(conta?.ativo ?? true)
  const [salvando, setSalvando] = React.useState(false)

  const digitos = numero.replace(/\D/g, '')
  const numeroValido = digitos.length >= 10 && digitos.length <= 15
  const podeSalvar = apelido.trim() !== '' && numeroValido && (conta !== null || token.trim().length >= 8)

  async function salvar() {
    setSalvando(true)
    const r = await salvarWhatsappContaAction({
      id: conta?.id,
      apelido: apelido.trim(),
      numero: digitos,
      provedor: provedor.trim() || 'wasender',
      token: token.trim() === '' ? undefined : token.trim(),
      ativo,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(conta ? 'Conta atualizada.' : 'Conta cadastrada.')
    setToken('')
    onOpenChange(false)
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.contas() })
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{conta ? 'Editar conta' : 'Nova conta de WhatsApp'}</DialogTitle>
          <DialogDescription>
            O número é usado como origem dos disparos quando os canais forem ligados. Nada é enviado
            nesta fase.
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
              <p className="text-xs text-muted-foreground">{formatarNumero(digitos)}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="provedor">Provedor</Label>
            <Input id="provedor" value={provedor} onChange={(e) => setProvedor(e.target.value)} />
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

export function WhatsappContas() {
  const [editando, setEditando] = React.useState<WhatsappConta | null>(null)
  const [criando, setCriando] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.contas(),
    queryFn: buscarContasWhatsapp,
  })

  return (
    <div className="space-y-4">
      <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.info)}>
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Cadastro apenas</p>
          <p>
            A integração de envio (e o inbox multi-conta) entra no próximo prompt. O que existe hoje
            é o cadastro e o round-robin que a régua de disparo usa para distribuir o volume entre os
            números.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Contas de WhatsApp</CardTitle>
            <CardDescription>Números de origem e seus tokens de provedor.</CardDescription>
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
                    <TableHead>Provedor</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                        Nenhuma conta cadastrada.
                      </TableCell>
                    </TableRow>
                  )}
                  {data.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.apelido}</TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {formatarNumero(c.numero)}
                      </TableCell>
                      <TableCell>{c.provedor}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.token_definido_em
                          ? `definido em ${formatarData(c.token_definido_em)}`
                          : 'não definido'}
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
