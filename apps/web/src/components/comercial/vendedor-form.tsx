'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TIPOS_VENDEDOR, TIPO_VENDEDOR_LABELS, type TipoVendedorId } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import {
  definirCarteiraPassivaAction,
  salvarAcessoAction,
  salvarTerritorioAction,
  salvarVendedorAction,
} from '@/actions/comercial'
import type { Tables } from '@jobsiteos/core'

/**
 * Cadastro de vendedor.
 *
 * O formulário muda com o tipo, e a diferença não é cosmética — é a distinção entre as
 * três formas de receber trabalho:
 *
 *   ORIGINADOR trabalha NOTA, e recebe por ESCOLHA: uma lista de empresas escolhidas a
 *   dedo. As NFs dessas empresas são dele. Quem originou a relação continua dono dela
 *   mesmo que a empresa mude de porte ou de estado.
 *
 *   CLOSER trabalha CONTA, e recebe por RECORTE: UF e faixa de faturamento. Além disso
 *   carrega uma CARTEIRA DE PASSIVAS — contas que antecipam sozinhas e cujo volume é a
 *   comissão dele. As duas coisas convivem: o recorte diz que negócio novo cai nele, a
 *   carteira diz que conta antiga ele mantém.
 *
 *   SDR também tem recorte, mas para a distribuição semanal — não para nota.
 *
 * NÃO EXISTE EXCLUIR. Vendedor se desativa. Apagar levaria junto a explicação de
 * comissões já pagas — o histórico de carteira aponta para ele.
 */

const SETTINGS_POR_TIPO: Record<TipoVendedorId, string> = {
  sdr: 'Recebe empresas na distribuição semanal, dentro do território e da cota.',
  originador: 'Recebe as NFs das empresas que você escolher abaixo. Nada de território.',
  vendedor: 'Recebe contas por território, e gere as contas passivas da carteira dele.',
}

/** Território é do closer (recorte de conta) e do SDR (recorte de distribuição). */
const TEM_TERRITORIO: Record<TipoVendedorId, boolean> = {
  sdr: true,
  vendedor: true,
  originador: false,
}

export interface EmpresaEscolhida {
  id: string
  razao_social: string | null
  cnpj: string
  uf: string | null
  estagio: string
  gestao_operacao: string | null
}

const COLUNAS_EMPRESA = 'id, razao_social, cnpj, uf, estagio, gestao_operacao'

/**
 * As duas carteiras que se montam a partir do vendedor, e o que cada uma pode conter.
 *
 * O recorte é do BANCO, não da tela: filtrar depois de buscar devolveria vinte linhas e
 * mostraria três, e a pessoa concluiria que a busca está quebrada.
 *
 * `aviso` existe porque empresa já escolhida que DEIXOU de ser elegível continua na
 * lista, marcada. Tirá-la sozinho seria decidir por quem cadastrou; a marca é o que faz
 * alguém revisar.
 */
interface ReguaCarteira {
  titulo: string
  explicacao: React.ReactNode
  vazio: string
  semResultado: string
  /** Recorte aplicado na consulta. */
  recorte: (q: ReturnType<typeof consultaBase>) => ReturnType<typeof consultaBase>
  elegivel: (e: EmpresaEscolhida) => boolean
  aviso: (e: EmpresaEscolhida) => string | null
}

function consultaBase() {
  return createClient().from('empresas').select(COLUNAS_EMPRESA)
}

const REGUA_ORIGINACAO: ReguaCarteira = {
  titulo: 'Carteira de originação',
  explicacao: (
    <>
      As NFs destas empresas — como sacado OU como fornecedor — são roteadas para este
      originador. A busca só mostra <strong>cliente em prospecção ativa</strong>: quem não é
      cliente não emite nota no funil, e a nota de passivo é descartada antes do roteamento.
    </>
  ),
  vazio: 'Nenhuma empresa ainda — sem carteira, nenhuma nota é roteada para ele.',
  semResultado:
    'Nenhum cliente em prospecção ativa com esse nome ou CNPJ. A gestão da conta se define na ' +
    'ficha da empresa, seção Comercial.',
  recorte: (q) => q.eq('estagio', 'cliente').eq('gestao_operacao', 'prospeccao_ativa'),
  elegivel: (e) => e.estagio === 'cliente' && e.gestao_operacao === 'prospeccao_ativa',
  aviso: (e) =>
    e.gestao_operacao === 'passivo'
      ? 'virou PASSIVA — a nota não é roteada'
      : e.estagio !== 'cliente'
        ? 'não é mais cliente ativo'
        : null,
}

const REGUA_PASSIVAS: ReguaCarteira = {
  titulo: 'Contas passivas na carteira',
  explicacao: (
    <>
      Contas que antecipam sozinhas e que este closer mantém. O <strong>volume antecipado
      por elas no mês</strong> é o que gera a comissão dele — não há NF roteada nem funil.
      Entrar aqui marca a empresa como passiva; sair devolve a gestão a &quot;não
      definido&quot;, porque parar de gerir não é decidir prospectar.
    </>
  ),
  vazio: 'Nenhuma conta passiva — a comissão por volume dele será zero.',
  semResultado:
    'Nenhum cliente ou ex-cliente com esse nome ou CNPJ. Só quem antecipa (ou antecipou) ' +
    'pode ser conta passiva.',
  recorte: (q) => q.in('estagio', ['cliente', 'ex_cliente']),
  elegivel: (e) => e.estagio === 'cliente' || e.estagio === 'ex_cliente',
  aviso: (e) => (e.estagio === 'ex_cliente' ? 'ex-cliente — volume tende a zero' : null),
}

function SeletorEmpresas({
  regua,
  escolhidas,
  onChange,
}: {
  regua: ReguaCarteira
  escolhidas: EmpresaEscolhida[]
  onChange: (e: EmpresaEscolhida[]) => void
}) {
  const [termo, setTermo] = React.useState('')
  const [buscando, setBuscando] = React.useState(false)
  const [buscou, setBuscou] = React.useState(false)
  const [achadas, setAchadas] = React.useState<EmpresaEscolhida[]>([])

  async function buscar() {
    const t = termo.trim()
    if (t.length < 3) return
    setBuscando(true)
    const digitos = t.replace(/\D/g, '')
    const q = regua.recorte(consultaBase())
    const { data } = digitos.length >= 6
      ? await q.like('cnpj', `${digitos}%`).limit(20)
      : await q.ilike('razao_social', `%${t}%`).limit(20)
    setAchadas((data ?? []) as EmpresaEscolhida[])
    setBuscou(true)
    setBuscando(false)
  }

  function adicionar(e: EmpresaEscolhida) {
    if (!regua.elegivel(e)) return
    if (escolhidas.some((x) => x.id === e.id)) return
    onChange([...escolhidas, e])
    setAchadas([])
    setBuscou(false)
    setTermo('')
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">{regua.titulo}</p>
      <p className="text-xs text-muted-foreground">{regua.explicacao}</p>

      <div className="flex min-w-0 gap-2">
        <Input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Nome ou CNPJ (mín. 3)"
          className="min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Enter aqui NÃO pode submeter o formulário inteiro.
              e.preventDefault()
              void buscar()
            }
          }}
        />
        <Button type="button" variant="outline" className="shrink-0" onClick={() => void buscar()} disabled={buscando}>
          {buscando ? 'Buscando…' : 'Buscar'}
        </Button>
      </div>

      {buscou && achadas.length === 0 && (
        <p className="text-xs text-muted-foreground">{regua.semResultado}</p>
      )}

      {achadas.length > 0 && (
        <ul className="max-h-40 divide-y overflow-y-auto overflow-x-hidden rounded-md border">
          {achadas.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.razao_social ?? e.cnpj}</span>
                <span className="block truncate text-xs text-muted-foreground">{e.uf ?? '—'}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                onClick={() => adicionar(e)}
              >
                Adicionar
              </Button>
            </li>
          ))}
        </ul>
      )}

      {escolhidas.length === 0 ? (
        <p className="text-xs text-muted-foreground">{regua.vazio}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-md border">
          {escolhidas.map((e) => {
            const aviso = regua.aviso(e)
            return (
              <li key={e.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{e.razao_social ?? e.cnpj}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {e.uf ?? '—'}
                    {aviso ? ` · ${aviso}` : ''}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => onChange(escolhidas.filter((x) => x.id !== e.id))}
                >
                  Remover
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Quais painéis este vendedor pode abrir além do próprio.
 *
 * Não é preferência de tela: desde a 0095 a RLS de funil, agenda e comissão lê esta
 * lista. Marcar aqui é conceder leitura de verdade — e só leitura, porque ver o funil
 * do outro não é agir em nome dele.
 */
function AcessosCruzados({
  vendedorId,
  vendedores,
  concedidos,
  onChange,
}: {
  vendedorId: string | null
  vendedores: readonly Tables<'vendedores'>[]
  concedidos: Set<string>
  onChange: (s: Set<string>) => void
}) {
  const outros = vendedores.filter((v) => v.ativo && v.id !== vendedorId)

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">Pode ver o painel de</p>
      <p className="text-xs text-muted-foreground">
        Funil, agenda e comissão de quem estiver marcado. Somente leitura. Admin e Comercial
        enxergam todos sem precisar de marca aqui.
      </p>
      {outros.length === 0 ? (
        <p className="text-xs text-muted-foreground">Não há outro vendedor cadastrado ainda.</p>
      ) : (
        <ul className="space-y-1">
          {outros.map((v) => (
            <li key={v.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={concedidos.has(v.id)}
                  onChange={(e) => {
                    const s = new Set(concedidos)
                    if (e.target.checked) s.add(v.id)
                    else s.delete(v.id)
                    onChange(s)
                  }}
                />
                {v.nome}
                <span className="text-xs text-muted-foreground">
                  {TIPO_VENDEDOR_LABELS[v.tipo as TipoVendedorId] ?? v.tipo}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

async function buscarUsuarios() {
  const supabase = createClient()
  const { data } = await supabase.from('usuarios').select('id, nome, email').eq('ativo', true).order('nome')
  return data ?? []
}

export interface VendedorFormProps {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  /** null = novo. */
  vendedor: Tables<'vendedores'> | null
  territorio: Tables<'vendedor_territorios'> | null
  /** Para a lista de acessos cruzados — quem existe para ser enxergado. */
  vendedores: readonly Tables<'vendedores'>[]
}

export function VendedorForm({ aberto, onOpenChange, vendedor, territorio, vendedores }: VendedorFormProps) {
  const qc = useQueryClient()
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [tipo, setTipo] = React.useState<TipoVendedorId>((vendedor?.tipo as TipoVendedorId) ?? 'sdr')
  const [ehIa, setEhIa] = React.useState(vendedor?.is_ia ?? false)
  const [escolhidas, setEscolhidas] = React.useState<EmpresaEscolhida[]>([])
  const [passivas, setPassivas] = React.useState<EmpresaEscolhida[]>([])
  const [acessos, setAcessos] = React.useState<Set<string>>(new Set())
  // O estado inicial guardado para o diff: `app_salvar_acesso_vendedor` concede ou revoga
  // um par por vez, então só o que mudou vira chamada.
  const acessosIniciais = React.useRef<Set<string>>(new Set())

  const usuarios = useQuery({ queryKey: ['comercial', 'usuarios'], queryFn: buscarUsuarios, enabled: aberto })

  React.useEffect(() => {
    if (!aberto) return
    setTipo((vendedor?.tipo as TipoVendedorId) ?? 'sdr')
    setEhIa(vendedor?.is_ia ?? false)
    setErro(null)

    // A carteira de originação guarda só ids nas settings; a tela precisa dos nomes.
    const ids = ((vendedor?.settings ?? {}) as { empresas_escolhidas?: string[] }).empresas_escolhidas ?? []
    if (ids.length === 0) setEscolhidas([])
    else {
      void createClient().from('empresas').select(COLUNAS_EMPRESA).in('id', ids)
        .then(({ data }) => setEscolhidas((data ?? []) as EmpresaEscolhida[]))
    }

    if (!vendedor) {
      setPassivas([])
      setAcessos(new Set())
      acessosIniciais.current = new Set()
      return
    }

    // A carteira de passivas mora em `vendedor_carteira` — temporal, porque é ela que a
    // comissão consulta na data do evento. Ler das settings daria a foto de hoje.
    void createClient()
      .from('vendedor_carteira')
      .select(`empresa_id, empresas(${COLUNAS_EMPRESA})`)
      .eq('vendedor_id', vendedor.id)
      .eq('papel', 'gestao_passiva')
      .is('ate', null)
      .then(({ data }) => {
        const linhas = (data ?? []) as unknown as { empresas: EmpresaEscolhida | null }[]
        setPassivas(linhas.map((l) => l.empresas).filter((e): e is EmpresaEscolhida => e !== null))
      })

    void createClient()
      .from('vendedor_acessos')
      .select('pode_ver_vendedor_id')
      .eq('vendedor_id', vendedor.id)
      .then(({ data }) => {
        const s = new Set((data ?? []).map((a) => a.pode_ver_vendedor_id))
        setAcessos(s)
        acessosIniciais.current = new Set(s)
      })
  }, [aberto, vendedor])

  const settings = (vendedor?.settings ?? {}) as { direcao?: string; empresas_por_semana?: number }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSalvando(true)
    setErro(null)

    const novasSettings: Record<string, unknown> = { ...(vendedor?.settings as object) }
    if (tipo === 'originador') {
      novasSettings.empresas_escolhidas = escolhidas.map((e) => e.id)
    } else {
      // Trocar de tipo apaga a carteira: um SDR com `empresas_escolhidas` pendurado é
      // um campo invisível que volta a valer se ele virar originador de novo.
      delete novasSettings.empresas_escolhidas
    }
    if (tipo === 'sdr') {
      novasSettings.direcao = String(fd.get('direcao') ?? 'both')
      const cota = Number(fd.get('cota'))
      if (Number.isFinite(cota) && cota > 0) novasSettings.empresas_por_semana = cota
      else delete novasSettings.empresas_por_semana
    }

    const r = await salvarVendedorAction({
      id: vendedor?.id,
      nome: String(fd.get('nome') ?? ''),
      tipo,
      usuario_id: ehIa ? null : String(fd.get('usuario_id') ?? '') || null,
      is_ia: ehIa,
      email_remetente: String(fd.get('email_remetente') ?? '') || null,
      settings: novasSettings,
      ativo: fd.get('ativo') === 'on',
    })

    if (!r.ok) {
      setSalvando(false)
      setErro(r.message)
      return
    }

    const id = r.data.id ?? vendedor?.id
    if (!id) {
      setSalvando(false)
      setErro('O vendedor foi salvo, mas o id não voltou — recarregue e edite de novo.')
      return
    }

    // Território na mesma submissão. Só para quem recebe por recorte — o originador
    // recebe por escolha, e um território nele seria um campo que não faz nada.
    if (TEM_TERRITORIO[tipo]) {
      const ufs = String(fd.get('ufs') ?? '')
        .split(',')
        .map((u) => u.trim().toUpperCase())
        .filter(Boolean)
      const t = await salvarTerritorioAction({
        vendedor_id: id,
        ufs,
        faturamento_min: fd.get('fat_min') ? Number(fd.get('fat_min')) : null,
        faturamento_max: fd.get('fat_max') ? Number(fd.get('fat_max')) : null,
      })
      if (!t.ok) {
        setSalvando(false)
        setErro(t.message)
        return
      }
    }

    // A carteira de passivas vai SEMPRE que o tipo é closer, inclusive vazia: a lista
    // vazia é o jeito de esvaziar a carteira, e pular a chamada faria "removi todas"
    // não gravar nada.
    if (tipo === 'vendedor') {
      const c = await definirCarteiraPassivaAction({
        vendedor_id: id,
        empresa_ids: passivas.map((p) => p.id),
      })
      if (!c.ok) {
        setSalvando(false)
        setErro(c.message)
        return
      }
    }

    for (const outro of new Set([...acessos, ...acessosIniciais.current])) {
      const antes = acessosIniciais.current.has(outro)
      const agora = acessos.has(outro)
      if (antes === agora) continue
      const a = await salvarAcessoAction({
        vendedor_id: id,
        pode_ver_vendedor_id: outro,
        conceder: agora,
      })
      if (!a.ok) {
        setSalvando(false)
        setErro(a.message)
        return
      }
    }

    setSalvando(false)
    toast.success(vendedor ? 'Vendedor atualizado.' : 'Vendedor cadastrado.')
    void qc.invalidateQueries({ queryKey: ['comercial'] })
    onOpenChange(false)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      {/* `overflow-x-hidden`: sem ele, um nome de empresa longo dentro do seletor empurra
          a largura e o modal inteiro ganha barra horizontal. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden sm:max-w-lg">
        <form onSubmit={enviar}>
          <DialogHeader>
            <DialogTitle>{vendedor ? 'Editar vendedor' : 'Novo vendedor'}</DialogTitle>
            <DialogDescription>
              Não existe excluir: vendedor se desativa. Apagar levaria junto a explicação de
              comissões já pagas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" name="nome" defaultValue={vendedor?.nome ?? ''} required minLength={2} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <select
                id="tipo"
                name="tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoVendedorId)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TIPOS_VENDEDOR.map((t) => (
                  <option key={t} value={t}>{TIPO_VENDEDOR_LABELS[t]}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{SETTINGS_POR_TIPO[tipo]}</p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ehIa} onChange={(e) => setEhIa(e.target.checked)} />
              Vendedor de IA (tem nome próprio e não tem login)
            </label>

            {!ehIa && (
              <div className="space-y-1.5">
                <Label htmlFor="usuario_id">Usuário</Label>
                <select
                  id="usuario_id"
                  name="usuario_id"
                  defaultValue={vendedor?.usuario_id ?? ''}
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione…</option>
                  {(usuarios.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.nome} · {u.email}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  É por aqui que &quot;Meu Painel&quot; sabe de quem é o funil.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email_remetente">E-mail remetente (opcional)</Label>
              <Input
                id="email_remetente"
                name="email_remetente"
                type="email"
                defaultValue={vendedor?.email_remetente ?? ''}
              />
            </div>

            {tipo === 'sdr' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="direcao">Direção</Label>
                  <select
                    id="direcao"
                    name="direcao"
                    defaultValue={settings.direcao ?? 'both'}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="out">Saída (recebe da distribuição)</option>
                    <option value="in">Entrada (recebe inbound, criado à mão)</option>
                    <option value="both">Os dois</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cota">Empresas por semana</Label>
                  <Input
                    id="cota"
                    name="cota"
                    type="number"
                    min={1}
                    placeholder="herda a config global"
                    defaultValue={settings.empresas_por_semana ?? ''}
                  />
                </div>
              </div>
            )}

            {TEM_TERRITORIO[tipo] && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Território</p>
                <p className="text-xs text-muted-foreground">
                  {tipo === 'vendedor'
                    ? 'Define quais contas são deste closer. É o que o SDR vê sugerido ao agendar a reunião.'
                    : 'Recorta o que este SDR recebe na distribuição semanal.'}{' '}
                  Em branco NÃO significa &quot;atende tudo&quot;: território vazio é ignorado,
                  senão um cadastro incompleto abocanha a base inteira.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="ufs">UFs (separadas por vírgula)</Label>
                  <Input
                    id="ufs"
                    name="ufs"
                    placeholder="SP, MG, PR"
                    defaultValue={(territorio?.ufs ?? []).join(', ')}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="fat_min">Faturamento mínimo</Label>
                    <Input id="fat_min" name="fat_min" type="number" min={0} step="1000"
                      defaultValue={territorio?.faturamento_min ?? ''} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fat_max">Faturamento máximo</Label>
                    <Input id="fat_max" name="fat_max" type="number" min={0} step="1000"
                      defaultValue={territorio?.faturamento_max ?? ''} />
                  </div>
                </div>
              </div>
            )}

            {tipo === 'originador' && (
              <SeletorEmpresas regua={REGUA_ORIGINACAO} escolhidas={escolhidas} onChange={setEscolhidas} />
            )}

            {tipo === 'vendedor' && (
              <SeletorEmpresas regua={REGUA_PASSIVAS} escolhidas={passivas} onChange={setPassivas} />
            )}

            <AcessosCruzados
              vendedorId={vendedor?.id ?? null}
              vendedores={vendedores}
              concedidos={acessos}
              onChange={setAcessos}
            />

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ativo" defaultChecked={vendedor?.ativo ?? true} />
              Ativo
            </label>
          </div>

          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
