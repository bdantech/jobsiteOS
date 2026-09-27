'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import {
  CANAIS_ENTREGA,
  CANAL_ENTREGA_LABELS,
  COBRANCA_CONFIG_PADRAO,
  COBRANCA_ESTAGIO_LABELS,
  INDICES_COBRANCA,
  INDICE_COBRANCA_LABELS,
  type CobrancaConfig as Config,
  type CobrancaConfigChave,
  type ConvenioProtesto,
  type IndiceCobranca,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { salvarCobrancaConfigAction } from '@/actions/cobranca-gestao'
import { buscarCobrancaConfig, buscarSouGestor, gestaoKeys } from './gestao-queries'
import { ApolicesCrud } from './cobranca-config-apolice'
import { cnpj } from './format'

/**
 * Settings da Cobrança (§13). Gestor edita; os demais veem — a RPC recusa a escrita de
 * quem não é gestor, e a tela só desliga os controles para não oferecer o que falharia.
 *
 * Cada aba salva a SUA seção inteira, validada pelo schema do core na action: uma
 * seção malformada no banco cai no padrão de fábrica inteiro na leitura, e é melhor a
 * pessoa ver o erro aqui do que descobrir o default depois.
 */
export function CobrancaConfig() {
  const qc = useQueryClient()
  const cfg = useQuery({ queryKey: gestaoKeys.config(), queryFn: buscarCobrancaConfig })
  const gestor = useQuery({ queryKey: gestaoKeys.gestor(), queryFn: buscarSouGestor })
  const podeEditar = gestor.data === true

  async function salvar(chave: CobrancaConfigChave, valor: unknown): Promise<boolean> {
    const r = await salvarCobrancaConfigAction(chave, valor)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success('Configuração salva.')
    void qc.invalidateQueries({ queryKey: gestaoKeys.config() })
    return true
  }

  if (cfg.isLoading || !cfg.data) return <Skeleton className="h-96 w-full" />
  const c = cfg.data

  return (
    <div className="space-y-3">
      {!podeEditar ? (
        <p className="text-sm text-muted-foreground">Somente leitura: as configurações são editadas pela gestão de cobrança.</p>
      ) : null}
      <Tabs defaultValue="cobranca" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="cobranca">Cobrança</TabsTrigger>
          <TabsTrigger value="calculo">Cálculo</TabsTrigger>
          <TabsTrigger value="apolice">Apólice</TabsTrigger>
          <TabsTrigger value="protesto">Protesto</TabsTrigger>
          <TabsTrigger value="credor">Credor</TabsTrigger>
          <TabsTrigger value="regularizacao">Regularização</TabsTrigger>
        </TabsList>

        <TabsContent value="cobranca" className="mt-0">
          <SecaoCobranca valor={c.cobranca} podeEditar={podeEditar} onSalvar={(v) => salvar('cobranca', v)} />
        </TabsContent>
        <TabsContent value="calculo" className="mt-0">
          <SecaoCalculo valor={c.calculo} podeEditar={podeEditar} onSalvar={(v) => salvar('calculo', v)} />
        </TabsContent>
        <TabsContent value="apolice" className="mt-0 space-y-4">
          <ApolicesCrud podeEditar={podeEditar} />
          <SecaoApolice valor={c.apolice} podeEditar={podeEditar} onSalvar={(v) => salvar('apolice', v)} />
        </TabsContent>
        <TabsContent value="protesto" className="mt-0">
          <SecaoProtesto valor={c.protesto} podeEditar={podeEditar} onSalvar={(v) => salvar('protesto', v)} />
        </TabsContent>
        <TabsContent value="credor" className="mt-0">
          <SecaoCredor valor={c.credor} podeEditar={podeEditar} onSalvar={(v) => salvar('credor', v)} />
        </TabsContent>
        <TabsContent value="regularizacao" className="mt-0">
          <SecaoRegularizacao valor={c.regularizacao} podeEditar={podeEditar} onSalvar={(v) => salvar('regularizacao', v)} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface SecaoProps<T> {
  valor: T
  podeEditar: boolean
  onSalvar: (v: T) => Promise<boolean>
}

/** Estado local da seção, reiniciado quando o banco devolve outro valor. */
function useRascunho<T>(valor: T): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const [r, setR] = React.useState(valor)
  const chave = JSON.stringify(valor)
  React.useEffect(() => setR(JSON.parse(chave) as T), [chave])
  return [r, setR, JSON.stringify(r) !== chave]
}

function Rodape({ podeEditar, alterado, onSalvar }: { podeEditar: boolean; alterado: boolean; onSalvar: () => Promise<unknown> }) {
  const [salvando, setSalvando] = React.useState(false)
  if (!podeEditar) return null
  return (
    <Button
      size="sm"
      disabled={!alterado || salvando}
      onClick={async () => {
        setSalvando(true)
        await onSalvar()
        setSalvando(false)
      }}
    >
      {salvando ? 'Salvando…' : 'Salvar'}
    </Button>
  )
}

function Numero({
  id,
  rotulo,
  valor,
  onChange,
  nota,
  disabled,
  step,
}: {
  id: string
  rotulo: string
  valor: number | null
  onChange: (n: number | null) => void
  nota?: string
  disabled?: boolean
  step?: string
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input
        id={id}
        type="number"
        step={step ?? '1'}
        value={valor === null || Number.isNaN(valor) ? '' : valor}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        disabled={disabled}
      />
      {nota ? <p className="text-[11px] text-muted-foreground">{nota}</p> : null}
    </div>
  )
}

// ─── Cobrança ───────────────────────────────────────────────────────────────

const ESTAGIOS_QUE_BLOQUEIAM = ['notificada', 'em_negociacao', 'acordo_firmado', 'judicializada'] as const

function SecaoCobranca({ valor, podeEditar, onSalvar }: SecaoProps<Config['cobranca']>) {
  const [r, setR, alterado] = useRascunho(valor)
  const [motivo, setMotivo] = React.useState('')
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Esteira de cobrança</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Numero
            id="c-inicio"
            rotulo="Início da cobrança (dias de atraso)"
            valor={r.dias_inicio_cobranca}
            onChange={(n) => setR({ ...r, dias_inicio_cobranca: n ?? 0 })}
            nota="Antes disso o atraso é tratado na plataforma de produção."
            disabled={!podeEditar}
          />
          <div className="space-y-1">
            <Numero
              id="c-prazo"
              rotulo="Prazo para pagamento na notificação"
              valor={r.prazo_pagamento_dias}
              onChange={(n) => setR({ ...r, prazo_pagamento_dias: n ?? 0 })}
              disabled={!podeEditar}
            />
            <div className="flex items-center gap-2">
              <Switch
                id="c-uteis"
                checked={r.prazo_pagamento_uteis}
                onCheckedChange={(v) => setR({ ...r, prazo_pagamento_uteis: v })}
                disabled={!podeEditar}
              />
              <Label htmlFor="c-uteis" className="font-normal">
                Dias úteis
              </Label>
            </div>
          </div>
          <Numero
            id="c-reit"
            rotulo="Lembrete de reiteração (dias)"
            valor={r.dias_para_reiteracao}
            onChange={(n) => setR({ ...r, dias_para_reiteracao: n ?? 0 })}
            nota="Só lembra o responsável; nada é enviado sozinho."
            disabled={!podeEditar}
          />
        </div>

        <div className="max-w-xs space-y-1">
          <Label>Estágio que bloqueia o sacado</Label>
          <Select
            value={r.estagio_que_bloqueia}
            onValueChange={(v) => setR({ ...r, estagio_que_bloqueia: v as Config['cobranca']['estagio_que_bloqueia'] })}
            disabled={!podeEditar}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESTAGIOS_QUE_BLOQUEIAM.map((e) => (
                <SelectItem key={e} value={e}>
                  {COBRANCA_ESTAGIO_LABELS[e]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Canais habilitados por padrão</Label>
          <div className="flex flex-wrap gap-3">
            {CANAIS_ENTREGA.map((canal) => (
              <label key={canal} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!podeEditar}
                  checked={r.canais_padrao.includes(canal)}
                  onChange={(e) =>
                    setR({
                      ...r,
                      canais_padrao: e.target.checked ? [...r.canais_padrao, canal] : r.canais_padrao.filter((x) => x !== canal),
                    })
                  }
                />
                {CANAL_ENTREGA_LABELS[canal]}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Motivos de encerramento</Label>
          <ul className="space-y-1">
            {r.motivos_encerramento.map((m, i) => (
              <li key={`${m}-${i}`} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-sm">
                {m}
                {podeEditar ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remover ${m}`}
                    onClick={() => setR({ ...r, motivos_encerramento: r.motivos_encerramento.filter((_, j) => j !== i) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {podeEditar ? (
            <div className="flex gap-2">
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Novo motivo" />
              <Button
                size="sm"
                variant="outline"
                disabled={motivo.trim().length < 2}
                onClick={() => {
                  setR({ ...r, motivos_encerramento: [...r.motivos_encerramento, motivo.trim()] })
                  setMotivo('')
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}
        </div>

        <Rodape podeEditar={podeEditar} alterado={alterado} onSalvar={() => onSalvar(r)} />
      </CardContent>
    </Card>
  )
}

// ─── Cálculo ────────────────────────────────────────────────────────────────

function SecaoCalculo({ valor, podeEditar, onSalvar }: SecaoProps<Config['calculo']>) {
  const [r, setR, alterado] = useRascunho(valor)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Atualização da dívida (padrão de toda cobrança nova)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Cada cobrança herda estes parâmetros e pode alterá-los na própria tela, com o valor herdado ao lado. O motor é o
          mesmo do Jurídico, sobre a mesma tabela de índices.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Numero id="k-juros" rotulo="Juros de mora (% a.m.)" step="0.01" valor={r.juros_mora_mes} onChange={(n) => setR({ ...r, juros_mora_mes: n ?? 0 })} disabled={!podeEditar} />
          <Numero id="k-multa" rotulo="Multa (%)" step="0.01" valor={r.multa_pct} onChange={(n) => setR({ ...r, multa_pct: n ?? 0 })} disabled={!podeEditar} />
          <Numero
            id="k-hon"
            rotulo="Honorários (% sobre o subtotal)"
            step="0.01"
            valor={r.honorarios_pct}
            onChange={(n) => setR({ ...r, honorarios_pct: n ?? 0 })}
            disabled={!podeEditar}
          />
          <div className="space-y-1">
            <Label>Índice de correção</Label>
            <Select value={r.indice} onValueChange={(v) => setR({ ...r, indice: v as IndiceCobranca })} disabled={!podeEditar}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDICES_COBRANCA.map((i) => (
                  <SelectItem key={i} value={i}>
                    {INDICE_COBRANCA_LABELS[i]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch id="k-prorata" checked={r.juros_pro_rata} onCheckedChange={(v) => setR({ ...r, juros_pro_rata: v })} disabled={!podeEditar} />
            <Label htmlFor="k-prorata" className="font-normal">
              Juros pro rata die
            </Label>
          </div>
        </div>
        <Rodape podeEditar={podeEditar} alterado={alterado} onSalvar={() => onSalvar(r)} />
      </CardContent>
    </Card>
  )
}

// ─── Apólice (alertas, contato, modo) ───────────────────────────────────────

function SecaoApolice({ valor, podeEditar, onSalvar }: SecaoProps<Config['apolice']>) {
  const [r, setR, alterado] = useRascunho(valor)
  const [envio, setEnvio] = React.useState(valor.alertas_dias.envio_sinistro.join(', '))
  React.useEffect(() => setEnvio(valor.alertas_dias.envio_sinistro.join(', ')), [valor.alertas_dias.envio_sinistro])
  const a = r.alertas_dias
  const setA = (p: Partial<typeof a>) => setR({ ...r, alertas_dias: { ...a, ...p } })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Alertas do relógio, contato da seguradora e modo de envio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Os alertas saem no dia D+N contado do vencimento ORIGINAL do título (push, e-mail e Meu Dia do responsável e do
          gestor). O crítico repete todo dia até o prazo ser resolvido.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Numero id="a-parada" rotulo="Aviso da parada de cobertura (D+)" valor={a.parada_cobertura} onChange={(n) => setA({ parada_cobertura: n ?? 0 })} nota="padrão D+45: 15 dias antes do D+60" disabled={!podeEditar} />
          <Numero id="a-notif" rotulo="Aviso de notificar a seguradora (D+)" valor={a.notificacao_seguradora} onChange={(n) => setA({ notificacao_seguradora: n ?? 0 })} nota="padrão D+75: 15 dias antes do D+90" disabled={!podeEditar} />
          <Numero id="a-crit" rotulo="Crítico, diário (D+)" valor={a.notificacao_critica} onChange={(n) => setA({ notificacao_critica: n ?? 0 })} nota="padrão D+85: 5 dias antes de perder a indenização" disabled={!podeEditar} />
          <Numero id="a-perda" rotulo="Aviso da Data da Perda (D+)" valor={a.data_perda} onChange={(n) => setA({ data_perda: n ?? 0 })} nota="padrão D+150: prepare o dossiê" disabled={!podeEditar} />
          <div className="space-y-1">
            <Label htmlFor="a-envio">Avisos do envio do sinistro (D+, separados por vírgula)</Label>
            <Input
              id="a-envio"
              value={envio}
              disabled={!podeEditar}
              onChange={(e) => {
                setEnvio(e.target.value)
                const ns = e.target.value
                  .split(/[,;\s]+/)
                  .map((x) => Number.parseInt(x, 10))
                  .filter((x) => Number.isFinite(x) && x > 0)
                setA({ envio_sinistro: ns.slice(0, 5) })
              }}
            />
            <p className="text-[11px] text-muted-foreground">padrão D+300 e D+345 (até 5 avisos)</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="a-fora"
            checked={r.alertar_titulos_fora_de_cobranca}
            onCheckedChange={(v) => setR({ ...r, alertar_titulos_fora_de_cobranca: v })}
            disabled={!podeEditar}
          />
          <Label htmlFor="a-fora" className="font-normal">
            Alertar também títulos vencidos que ainda não estão em cobrança
          </Label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="a-cnome">Contato da seguradora — nome (broker/gestor de conta)</Label>
            <Input
              id="a-cnome"
              value={r.contato_seguradora.nome ?? ''}
              disabled={!podeEditar}
              onChange={(e) => setR({ ...r, contato_seguradora: { ...r.contato_seguradora, nome: e.target.value || null } })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-cmail">Contato da seguradora — e-mail</Label>
            <Input
              id="a-cmail"
              type="email"
              value={r.contato_seguradora.email ?? ''}
              disabled={!podeEditar}
              onChange={(e) => setR({ ...r, contato_seguradora: { ...r.contato_seguradora, email: e.target.value.trim() || null } })}
            />
            <p className="text-[11px] text-muted-foreground">É para onde o modo manual manda a notificação e o dossiê.</p>
          </div>
        </div>

        <div className="max-w-md space-y-1">
          <Label>Modo de envio à seguradora</Label>
          <Select value={r.modo_envio} onValueChange={(v) => setR({ ...r, modo_envio: v as 'manual' | 'api' })} disabled={!podeEditar}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual — e-mail formal com dossiê</SelectItem>
              <SelectItem value="api">API Non-Payments (Atradius)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            A API exige entitlement liberado pela Atradius para a apólice (não é self-serve). Ligar a API muda só o
            transporte — o dossiê é o mesmo, e o modo manual continua disponível no mesmo botão se a chamada falhar.
          </p>
        </div>

        <Rodape podeEditar={podeEditar} alterado={alterado} onSalvar={() => onSalvar(r)} />
      </CardContent>
    </Card>
  )
}

// ─── Protesto ───────────────────────────────────────────────────────────────

const NOVO_CONVENIO: ConvenioProtesto = { uf: '', cra: '', modo: 'portal_manual', ativo: true, credencial_ref: null }

function SecaoProtesto({ valor, podeEditar, onSalvar }: SecaoProps<Config['protesto']>) {
  const [r, setR, alterado] = useRascunho(valor)
  const [novo, setNovo] = React.useState<ConvenioProtesto>(NOVO_CONVENIO)
  const setConv = (i: number, p: Partial<ConvenioProtesto>) =>
    setR({ ...r, convenios: r.convenios.map((c, j) => (j === i ? { ...c, ...p } : c)) })

  const semJustificativa = !r.retirar_protesto_ao_quitar && (r.justificativa_nao_retirar ?? '').trim().length < 10

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Protesto</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          O convênio de apresentante é ESTADUAL (IEPTB/CRA de cada UF) e exige o e-CNPJ ICP-Brasil da cessionária. A
          credencial nunca fica aqui: guarde-a no Vault/env do worker e informe só a referência.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">UF</TableHead>
              <TableHead>CRA</TableHead>
              <TableHead className="w-44">Modo</TableHead>
              <TableHead>Referência da credencial (Vault)</TableHead>
              <TableHead className="w-20">Ativo</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.convenios.map((c, i) => (
              <TableRow key={`${c.uf}-${i}`}>
                <TableCell className="font-mono">{c.uf}</TableCell>
                <TableCell>
                  <Input value={c.cra} onChange={(e) => setConv(i, { cra: e.target.value })} disabled={!podeEditar} />
                </TableCell>
                <TableCell>
                  <Select value={c.modo} onValueChange={(v) => setConv(i, { modo: v as ConvenioProtesto['modo'] })} disabled={!podeEditar}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portal_manual">Portal (manual)</SelectItem>
                      <SelectItem value="api">API</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    value={c.credencial_ref ?? ''}
                    placeholder="ex.: vault:protesto_sp"
                    onChange={(e) => setConv(i, { credencial_ref: e.target.value.trim() || null })}
                    disabled={!podeEditar}
                  />
                </TableCell>
                <TableCell>
                  <Switch checked={c.ativo} onCheckedChange={(v) => setConv(i, { ativo: v })} disabled={!podeEditar} aria-label={`Ativar ${c.uf}`} />
                </TableCell>
                <TableCell>
                  {podeEditar ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remover ${c.uf}`}
                      onClick={() => setR({ ...r, convenios: r.convenios.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {r.convenios.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum convênio. Sem convênio na UF do devedor, o protesto não sai.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {podeEditar ? (
          <div className="grid gap-2 sm:grid-cols-[5rem_1fr_auto]">
            <Input placeholder="UF" maxLength={2} value={novo.uf} onChange={(e) => setNovo({ ...novo, uf: e.target.value.toUpperCase() })} />
            <Input placeholder="CRA (ex.: CENPROT-SP)" value={novo.cra} onChange={(e) => setNovo({ ...novo, cra: e.target.value })} />
            <Button
              size="sm"
              variant="outline"
              disabled={!/^[A-Z]{2}$/.test(novo.uf) || novo.cra.trim().length < 2 || r.convenios.some((c) => c.uf === novo.uf)}
              onClick={() => {
                setR({ ...r, convenios: [...r.convenios, { ...novo, cra: novo.cra.trim() }] })
                setNovo(NOVO_CONVENIO)
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Convênio
            </Button>
          </div>
        ) : null}

        <div className="max-w-xs">
          <Numero
            id="p-custas"
            rotulo="Custas padrão por título (R$)"
            step="0.01"
            valor={r.custas_padrao}
            onChange={(n) => setR({ ...r, custas_padrao: n })}
            disabled={!podeEditar}
          />
        </div>

        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Switch
              id="p-retirar"
              checked={r.retirar_protesto_ao_quitar}
              onCheckedChange={(v) => setR({ ...r, retirar_protesto_ao_quitar: v })}
              disabled={!podeEditar}
            />
            <Label htmlFor="p-retirar" className="font-normal">
              Retirar o protesto ao quitar (instrução de cancelamento obrigatória)
            </Label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Protesto não retirado depois de pago vira dano moral contra nós. Desligar exige justificativa (mín. 10
            caracteres), registrada no audit log.
          </p>
          {!r.retirar_protesto_ao_quitar ? (
            <Textarea
              rows={2}
              placeholder="Justificativa para não retirar o protesto após a quitação"
              value={r.justificativa_nao_retirar ?? ''}
              onChange={(e) => setR({ ...r, justificativa_nao_retirar: e.target.value || null })}
              disabled={!podeEditar}
            />
          ) : null}
        </div>

        <Rodape
          podeEditar={podeEditar}
          alterado={alterado && !semJustificativa}
          onSalvar={() =>
            onSalvar({ ...r, justificativa_nao_retirar: r.retirar_protesto_ao_quitar ? null : r.justificativa_nao_retirar })
          }
        />
      </CardContent>
    </Card>
  )
}

// ─── Credor ─────────────────────────────────────────────────────────────────

function SecaoCredor({ valor, podeEditar, onSalvar }: SecaoProps<Config['credor']>) {
  const [r, setR, alterado] = useRascunho(valor)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Credor (nós — a cessionária)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cr-razao">Razão social</Label>
            <Input id="cr-razao" value={r.razao_social} onChange={(e) => setR({ ...r, razao_social: e.target.value })} disabled={!podeEditar} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cr-cnpj">CNPJ</Label>
            <Input
              id="cr-cnpj"
              value={r.cnpj}
              onChange={(e) => setR({ ...r, cnpj: e.target.value.replace(/\D/g, '').slice(0, 14) })}
              disabled={!podeEditar}
            />
            <p className="text-[11px] text-muted-foreground">{cnpj(r.cnpj)}</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cr-pag">Dados de pagamento</Label>
          <Textarea
            id="cr-pag"
            rows={4}
            placeholder="Banco, agência, conta, PIX…"
            value={r.dados_pagamento ?? ''}
            onChange={(e) => setR({ ...r, dados_pagamento: e.target.value || null })}
            disabled={!podeEditar}
          />
          <p className="text-[11px] text-muted-foreground">
            Obrigatório para gerar notificações: é o que entra em {'{{dados_pagamento}}'}. Sem ele, a geração do PDF recusa
            em vez de imprimir uma carta sem meio de pagamento.
          </p>
          {!r.dados_pagamento?.trim() ? (
            <p className="text-xs text-destructive">Sem dados de pagamento cadastrados — nenhuma notificação poderá ser gerada.</p>
          ) : null}
        </div>
        <Rodape podeEditar={podeEditar} alterado={alterado} onSalvar={() => onSalvar(r)} />
      </CardContent>
    </Card>
  )
}

// ─── Regularização ──────────────────────────────────────────────────────────

function SecaoRegularizacao({ valor, podeEditar, onSalvar }: SecaoProps<Config['regularizacao']>) {
  const [r, setR, alterado] = useRascunho(valor)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Regularização do sacado</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch
            id="rg-auto"
            checked={r.restaurar_limite_automaticamente}
            onCheckedChange={(v) => setR({ restaurar_limite_automaticamente: v })}
            disabled={!podeEditar}
          />
          <Label htmlFor="rg-auto" className="font-normal">
            Restaurar o limite de crédito automaticamente ao regularizar
          </Label>
        </div>
        <p className="text-sm text-muted-foreground">
          Desligado (padrão {COBRANCA_CONFIG_PADRAO.regularizacao.restaurar_limite_automaticamente ? 'ligado' : 'desligado'}), a
          regularização põe o grupo em <strong>revisão pós-inadimplência</strong> na esteira de crédito: o limite não volta
          sozinho ao valor anterior, e a próxima decisão é uma revisão humana. Quem já não pagou uma vez merece uma
          segunda olhada, não um carimbo.
        </p>
        <Rodape podeEditar={podeEditar} alterado={alterado} onSalvar={() => onSalvar(r)} />
      </CardContent>
    </Card>
  )
}
