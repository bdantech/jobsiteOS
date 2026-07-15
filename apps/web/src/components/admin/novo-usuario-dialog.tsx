'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Check, Copy, Plus, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { criarUsuarioSchema, type CriarUsuarioInput } from '@jobsiteos/core'
import { criarUsuarioAction, type CriarUsuarioResult } from '@/actions/admin'
import type { PerfilOpcao } from '@/components/admin/usuarios-table'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Shown ONLY when Resend failed. The user was still created, so the password has
 * to reach the admin somehow or the account is dead on arrival. This is the one
 * moment it is ever visible in the browser — it is not stored anywhere and
 * cannot be retrieved again.
 */
function SenhaDeContingencia({ resultado, onFechar }: { resultado: CriarUsuarioResult; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false)
  const senha = resultado.senhaTemporaria ?? ''

  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('Não foi possível copiar. Selecione e copie manualmente.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-medium text-destructive">O e-mail não pôde ser enviado.</p>
          <p className="mt-1 text-muted-foreground">
            A conta de <strong>{resultado.nome}</strong> foi criada normalmente, mas o e-mail com a
            senha temporária falhou. Copie a senha abaixo e entregue-a ao usuário por um canal
            seguro.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{resultado.email}</p>

        <div className="flex items-center gap-2">
          <code className="flex-1 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">
            {senha}
          </code>
          <Button type="button" variant="outline" size="icon" onClick={copiar} aria-label="Copiar senha">
            {copiado ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Esta senha aparece <strong>uma única vez</strong> e não fica salva em lugar nenhum. No
          primeiro acesso o usuário será obrigado a trocá-la.
        </p>

        {resultado.erroEmail ? (
          <p className="text-xs text-muted-foreground">Detalhe do erro: {resultado.erroEmail}</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" onClick={onFechar}>
          Já copiei a senha
        </Button>
      </DialogFooter>
    </div>
  )
}

export function NovoUsuarioDialog({ perfis }: { perfis: PerfilOpcao[] }) {
  const [aberto, setAberto] = useState(false)
  const [contingencia, setContingencia] = useState<CriarUsuarioResult | null>(null)
  const [pending, startTransition] = useTransition()

  const form = useForm<CriarUsuarioInput>({
    resolver: zodResolver(criarUsuarioSchema),
    defaultValues: { nome: '', email: '', perfil_id: '' },
  })

  function fecharTudo() {
    setContingencia(null)
    setAberto(false)
    form.reset()
  }

  function onOpenChange(proximo: boolean) {
    // While the contingency password is on screen, closing must be a deliberate
    // act ("Já copiei a senha") — an accidental outside-click would destroy the
    // only copy of it.
    if (!proximo && contingencia) return
    setAberto(proximo)
    if (!proximo) form.reset()
  }

  function onSubmit(valores: CriarUsuarioInput) {
    startTransition(async () => {
      const resultado = await criarUsuarioAction(valores)

      if (!resultado.ok) {
        // Re-attach server-side field errors (duplicate e-mail, dead perfil) to
        // the inputs that caused them.
        if (resultado.fieldErrors) {
          for (const [campo, mensagens] of Object.entries(resultado.fieldErrors)) {
            const mensagem = mensagens?.[0]
            if (!mensagem) continue
            if (campo === 'nome' || campo === 'email' || campo === 'perfil_id') {
              form.setError(campo, { message: mensagem })
            }
          }
        }
        toast.error(resultado.message)
        return
      }

      if (!resultado.data.emailEnviado) {
        setContingencia(resultado.data)
        return
      }

      toast.success(`Usuário criado. A senha temporária foi enviada para ${resultado.data.email}.`)
      fecharTudo()
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button disabled={perfis.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Novo usuário
        </Button>
      </DialogTrigger>

      <DialogContent
        className="sm:max-w-[480px]"
        // Same reason as onOpenChange: don't let Esc or a click-away nuke the
        // only copy of the password.
        onEscapeKeyDown={(e) => contingencia && e.preventDefault()}
        onInteractOutside={(e) => contingencia && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{contingencia ? 'Usuário criado' : 'Novo usuário'}</DialogTitle>
          <DialogDescription>
            {contingencia
              ? 'A conta foi criada, mas o e-mail falhou.'
              : 'O usuário recebe por e-mail uma senha temporária e é obrigado a trocá-la no primeiro acesso.'}
          </DialogDescription>
        </DialogHeader>

        {contingencia ? (
          <SenhaDeContingencia resultado={contingencia} onFechar={fecharTudo} />
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input placeholder="Maria Silva" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="maria@oneos.com.br"
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="perfil_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Perfil</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um perfil" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {perfis.map((perfil) => (
                          <SelectItem key={perfil.id} value={perfil.id}>
                            <span className="flex items-center gap-1.5">
                              {perfil.nome}
                              {perfil.concedeAdmin ? (
                                <ShieldCheck
                                  className="h-3.5 w-3.5 text-primary"
                                  aria-label="Concede acesso à Administração"
                                />
                              ) : null}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      O perfil define quais módulos o usuário enxerga.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAberto(false)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Criando…' : 'Criar usuário'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
