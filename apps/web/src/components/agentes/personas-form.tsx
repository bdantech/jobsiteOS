'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Camera, Info, Save } from 'lucide-react'
import {
  LIMITES_AGENTE_PADRAO,
  escopoSchema,
  lerLimitesAgente,
  personaSchema,
  type ConfigAgentes,
  type Grupo,
  type LimitesAgente,
  type ModoRodagem,
} from '@jobsiteos/core'
import { STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { salvarPersonaAction } from '@/actions/agentes-gestao'
import { cn } from '@/lib/utils'
import { centavosDeTexto, dataCurta, extensaoDe, textoDeCentavos } from './gestao-format'
import { CaixaEmailCampo, NENHUM } from './personas-caixas'
import {
  enviarArquivoAgentes,
  gestaoAgentesKeys,
  urlAssinadaMaterial,
  type AgenteIa,
  type CaixaEmail,
  type Closer,
  type ContaIa,
} from './queries-gestao'
import { FiltroComPrevia, arvoreInicial, problemasDaArvore } from './regras-filtro'

/**
 * O CADASTRO DE UMA PERSONA (Prompt 09 §3, §11.3) — o vendedor de IA como entidade
 * completa: quem ele é diante do cliente, por onde fala, para quem entrega, onde pode
 * trabalhar e quanto pode fazer por dia.
 *
 * ─── AS TRAVAS MORAM NA RPC ─────────────────────────────────────────────────
 * `app_agentes_salvar_persona` recusa agente autônomo sem linha de WhatsApp própria e
 * ativa, linha que já é de outro agente ativo e closer que não seja humano. A tela avisa
 * ANTES (para ninguém preencher tudo e descobrir no fim), mas não bloqueia: a mensagem da
 * RPC é a fonte da verdade e aparece inteira no toast.
 *
 * ─── PILOTO LIMITA A QUEM; COTA LIMITA QUANTO ───────────────────────────────
 * São duas cercas diferentes e as duas valem juntas. O piloto é um filtro POR CIMA do
 * escopo enquanto `modo_rodagem = 'piloto'` — onde errar é barato primeiro. As cotas são
 * volume por dia, qualquer que seja o modo. Confundir as duas é como um agente "em
 * piloto" acaba ligando para a base inteira, trinta vezes por dia.
 */

type Populacao = 'empresas' | 'notas'

interface Arvores {
  filtro: Grupo | null
  filtro_nf: Grupo | null
  piloto: Grupo | null
  piloto_nf: Grupo | null
}

const POPULACAO_DA_CHAVE: Record<keyof Arvores, Populacao> = {
  filtro: 'empresas',
  filtro_nf: 'notas',
  piloto: 'empresas',
  piloto_nf: 'notas',
}

const COTAS: readonly { chave: Exclude<keyof LimitesAgente, 'gasto_diario_centavos'>; rotulo: string; nota?: string }[] = [
  { chave: 'ligacoes_por_dia', rotulo: 'Ligações por dia' },
  { chave: 'mensagens_por_dia', rotulo: 'Mensagens de WhatsApp por dia' },
  { chave: 'emails_por_dia', rotulo: 'E-mails por dia' },
  {
    chave: 'mandatos_ativos',
    rotulo: 'Mandatos ativos ao mesmo tempo',
    nota: 'Teto que as regras de mandato respeitam.',
  },
  { chave: 'acoes_por_mandato_por_dia', rotulo: 'Ações por mandato por dia' },
  { chave: 'tentativas_por_contato', rotulo: 'Tentativas por contato' },
  { chave: 'cooldown_minutos_mesmo_contato', rotulo: 'Intervalo no mesmo contato (min)' },
]

interface Rascunho {
  nome: string
  tipo: 'sdr' | 'originador'
  nome_exibicao: string
  tom: string
  bio_curta: string
  assinatura_email: string
  genero_gramatical: 'feminino' | 'masculino' | 'neutro'
  foto_path: string | null
  whatsapp_conta_id: string | null
  email_caixa_id: string | null
  email_remetente: string
  voz_conta_id: string
  closer_id: string | null
  closer_substituto_id: string | null
  modo_escopo: 'filtro' | 'carteira'
  arvores: Arvores
  cotas: Record<string, string>
  gasto_diario: string
  modo_rodagem: ModoRodagem
  autonomo: boolean
  ativo: boolean
}

function rascunhoDe(agente: AgenteIa | null): { rascunho: Rascunho; invalidas: Partial<Record<keyof Arvores, boolean>> } {
  const persona = personaSchema.partial().safeParse(agente?.persona ?? {})
  const p = persona.success ? persona.data : {}
  const escopoLido = escopoSchema.safeParse(agente?.escopo ?? {})
  const escopo = escopoLido.success ? escopoLido.data : { modo: 'filtro' as const }
  const limites = agente ? lerLimitesAgente(agente.limites) : LIMITES_AGENTE_PADRAO
  const invalidas: Partial<Record<keyof Arvores, boolean>> = {}
  const arvores = {} as Arvores
  for (const chave of Object.keys(POPULACAO_DA_CHAVE) as (keyof Arvores)[]) {
    const lido = arvoreInicial(POPULACAO_DA_CHAVE[chave], escopo[chave])
    arvores[chave] = lido.arvore
    if (lido.invalida) invalidas[chave] = true
  }
  const cotas: Record<string, string> = {}
  for (const c of COTAS) cotas[c.chave] = String(limites[c.chave])
  return {
    invalidas,
    rascunho: {
      nome: agente?.nome ?? '',
      tipo: agente?.tipo === 'originador' ? 'originador' : 'sdr',
      nome_exibicao: p.nome_exibicao ?? '',
      tom: p.tom ?? '',
      bio_curta: p.bio_curta ?? '',
      assinatura_email: p.assinatura_email ?? '',
      genero_gramatical: p.genero_gramatical ?? 'feminino',
      foto_path: p.foto_path ?? null,
      whatsapp_conta_id: agente?.whatsapp_conta_id ?? null,
      email_caixa_id: agente?.email_caixa_id ?? null,
      email_remetente: agente?.email_remetente ?? '',
      voz_conta_id: agente?.voz_conta_id ?? '',
      closer_id: agente?.closer_id ?? null,
      closer_substituto_id: agente?.closer_substituto_id ?? null,
      modo_escopo: escopo.modo ?? 'filtro',
      arvores,
      cotas,
      gasto_diario: textoDeCentavos(limites.gasto_diario_centavos),
      modo_rodagem: agente?.modo_rodagem === 'pleno' ? 'pleno' : 'piloto',
      autonomo: agente?.autonomo ?? false,
      ativo: agente?.ativo ?? true,
    },
  }
}

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{titulo}</CardTitle>
        {descricao ? <CardDescription>{descricao}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

function Aviso({ tom = 'warning', children }: { tom?: 'warning' | 'info' | 'critical'; children: React.ReactNode }) {
  const Icone = tom === 'info' ? Info : AlertTriangle
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE[tom])}>
      <Icone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">{children}</div>
    </div>
  )
}

export function PersonaForm({
  agente,
  agentes,
  contasIa,
  caixas,
  closers,
  config,
  onFechar,
  onSalvo,
}: {
  agente: AgenteIa | null
  agentes: AgenteIa[]
  contasIa: ContaIa[]
  caixas: CaixaEmail[]
  closers: Closer[]
  config: ConfigAgentes
  onFechar: () => void
  onSalvo: (id: string) => void
}) {
  const qc = useQueryClient()
  // Lido UMA vez: o pai remonta o formulário quando troca de agente (`key`). Reler a cada
  // refetch apagaria o que o gestor está digitando sempre que alguém pausasse o agente
  // ou reabrisse o disjuntor no cartão logo abaixo.
  const [inicial] = React.useState(() => rascunhoDe(agente))
  const [r, setR] = React.useState<Rascunho>(inicial.rascunho)
  const [salvando, setSalvando] = React.useState(false)
  const [enviandoFoto, setEnviandoFoto] = React.useState(false)

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((atual) => ({ ...atual, [k]: v }))
  const setArvore = (k: keyof Arvores, v: Grupo | null) =>
    setR((atual) => ({ ...atual, arvores: { ...atual.arvores, [k]: v } }))

  const foto = useQuery({
    queryKey: [...gestaoAgentesKeys.all, 'foto', r.foto_path],
    queryFn: () => urlAssinadaMaterial(r.foto_path as string),
    enabled: Boolean(r.foto_path),
    staleTime: 5 * 60_000,
  })

  const donoDaLinha = (contaId: string) =>
    agentes.find((a) => a.whatsapp_conta_id === contaId && a.ativo && a.id !== agente?.id) ?? null
  const contaEscolhida = contasIa.find((c) => c.id === r.whatsapp_conta_id) ?? null
  const semLinhaBoa = !contaEscolhida || !contaEscolhida.ativo
  const closer = closers.find((c) => c.id === r.closer_id) ?? null
  const hoje = new Date().toISOString().slice(0, 10)
  const closerAusente = closer?.ausente_ate && closer.ausente_ate >= hoje ? closer.ausente_ate : null
  const carteiraHabilitada = config.geral.modo_carteira_habilitado

  async function trocarFoto(arquivo: File | undefined) {
    if (!arquivo) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type)) {
      toast.error('A foto precisa ser JPG, PNG ou WebP.')
      return
    }
    const ext = extensaoDe(arquivo.name) || arquivo.type.split('/')[1] || 'jpg'
    // `personas/<id do agente>.<ext>` na primeira foto; troca de foto (ou agente que ainda
    // não existe) vai para um uuid novo. O bucket só tem política de INSERT para o gestor —
    // sobrescrever o mesmo caminho exigiria UPDATE, e a troca falharia.
    const base = agente?.id && !r.foto_path ? agente.id : crypto.randomUUID()
    const caminho = `personas/${base}.${ext}`
    setEnviandoFoto(true)
    try {
      await enviarArquivoAgentes(caminho, arquivo)
      set('foto_path', caminho)
      void qc.invalidateQueries({ queryKey: [...gestaoAgentesKeys.all, 'foto', caminho] })
      toast.success('Foto enviada. Salve a persona para gravar.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar a foto.')
    } finally {
      setEnviandoFoto(false)
    }
  }

  async function salvar() {
    if (r.nome.trim().length < 2) return void toast.error('Dê um nome interno ao agente (2 letras ou mais).')
    if (!r.nome_exibicao.trim()) return void toast.error('Dê o nome de exibição — é como o agente se apresenta.')

    for (const k of Object.keys(r.arvores) as (keyof Arvores)[]) {
      const probs = problemasDaArvore(POPULACAO_DA_CHAVE[k], r.arvores[k])
      if (probs.length > 0) return void toast.error(`Filtro incompleto: ${probs[0]}`)
    }

    const limites: Record<string, number> = {}
    for (const c of COTAS) {
      const n = Number(r.cotas[c.chave])
      if (!Number.isInteger(n) || n < 0) return void toast.error(`"${c.rotulo}" precisa ser um número inteiro.`)
      limites[c.chave] = n
    }
    const gasto = r.gasto_diario.trim() === '' ? 0 : centavosDeTexto(r.gasto_diario)
    if (gasto === null) return void toast.error('Gasto diário inválido. Use reais, ex.: 25,00.')
    limites.gasto_diario_centavos = gasto

    setSalvando(true)
    const res = await salvarPersonaAction({
      id: agente?.id ?? null,
      nome: r.nome.trim(),
      tipo: r.tipo,
      persona: {
        nome_exibicao: r.nome_exibicao.trim(),
        tom: r.tom.trim() || null,
        bio_curta: r.bio_curta.trim() || null,
        assinatura_email: r.assinatura_email.trim() || null,
        genero_gramatical: r.genero_gramatical,
        foto_path: r.foto_path,
      },
      whatsapp_conta_id: r.whatsapp_conta_id,
      email_caixa_id: r.email_caixa_id,
      email_remetente: r.email_remetente.trim() || null,
      voz_conta_id: r.voz_conta_id.trim() || null,
      closer_id: r.closer_id,
      closer_substituto_id: r.closer_substituto_id,
      escopo: { modo: r.modo_escopo, ...r.arvores },
      limites,
      modo_rodagem: r.modo_rodagem,
      autonomo: r.autonomo,
      ativo: r.ativo,
    })
    setSalvando(false)
    if (!res.ok) {
      toast.error(res.message, { duration: 10_000 })
      return
    }
    toast.success(agente ? 'Persona salva.' : 'Agente criado. O disjuntor nasceu com os limiares padrão.')
    // Espera a lista voltar antes de trocar para o agente salvo: sem isso, um agente recém-
    // criado ainda não está nela, o formulário continua "novo" e um segundo clique cria outro.
    await qc.invalidateQueries({ queryKey: gestaoAgentesKeys.personas() })
    void qc.invalidateQueries({ queryKey: gestaoAgentesKeys.all })
    onSalvo(res.data.id)
  }

  const principalNf = r.tipo === 'originador'

  const filtrosEmpresas = (
    <div className="space-y-3">
      <FiltroComPrevia
        populacao="empresas"
        titulo="Escopo por empresa"
        descricao="Porte, UF, score, estágio, fit do SDR… A população de reunião, qualificação e reativação."
        arvore={r.arvores.filtro}
        onChange={(a) => setArvore('filtro', a)}
        invalidaGravada={inicial.invalidas.filtro}
        semFiltro="Sem filtro de escopo, o agente pode trabalhar qualquer empresa (fora cobrança e supressão, que nunca entram) — as regras de mandato ainda precisam do filtro delas."
      />
      <FiltroComPrevia
        populacao="empresas"
        titulo="Piloto por empresa"
        descricao="Filtro adicional, POR CIMA do escopo, que só vale enquanto o modo de rodagem é piloto."
        arvore={r.arvores.piloto}
        onChange={(a) => setArvore('piloto', a)}
        base={problemasDaArvore('empresas', r.arvores.filtro).length === 0 ? r.arvores.filtro : null}
        invalidaGravada={inicial.invalidas.piloto}
        semFiltro="Sem piloto: em modo piloto, o agente trabalha o escopo inteiro."
        contarSemFiltro={false}
      />
    </div>
  )

  const filtrosNotas = (
    <div className="space-y-3">
      <FiltroComPrevia
        populacao="notas"
        titulo="Escopo por nota fiscal"
        descricao="Faixa de valor, sacado, vencimento — o catálogo das faixas do funil de NFs. A população da originação."
        arvore={r.arvores.filtro_nf}
        onChange={(a) => setArvore('filtro_nf', a)}
        invalidaGravada={inicial.invalidas.filtro_nf}
        semFiltro="Sem filtro de notas, o agente pode originar qualquer nota a prospectar."
      />
      <FiltroComPrevia
        populacao="notas"
        titulo="Piloto por nota fiscal"
        descricao="Filtro adicional sobre as notas, só enquanto o modo de rodagem é piloto."
        arvore={r.arvores.piloto_nf}
        onChange={(a) => setArvore('piloto_nf', a)}
        base={problemasDaArvore('notas', r.arvores.filtro_nf).length === 0 ? r.arvores.filtro_nf : null}
        invalidaGravada={inicial.invalidas.piloto_nf}
        semFiltro="Sem piloto de notas: em modo piloto, vale o escopo de notas inteiro."
        contarSemFiltro={false}
      />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onFechar}>
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Voltar para a lista
        </Button>
        <Button disabled={salvando || enviandoFoto} onClick={() => void salvar()}>
          <Save className="mr-2 h-4 w-4" aria-hidden />
          {salvando ? 'Salvando…' : agente ? 'Salvar persona' : 'Criar agente'}
        </Button>
      </div>

      {/* ─── Identidade ─────────────────────────────────────────────────── */}
      <Secao
        titulo="Quem é o agente"
        descricao="O nome interno aparece nas telas; o nome de exibição e o tom são como ele se apresenta ao cliente."
      >
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border bg-muted">
              {foto.data ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={foto.data}
                  alt={`Foto de ${r.nome_exibicao || r.nome}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Camera className="h-8 w-8 text-muted-foreground" aria-hidden />
              )}
            </div>
            <Label className="cursor-pointer text-xs text-primary underline-offset-2 hover:underline">
              {enviandoFoto ? 'Enviando…' : r.foto_path ? 'Trocar foto' : 'Enviar foto'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={enviandoFoto}
                onChange={(e) => void trocarFoto(e.target.files?.[0])}
              />
            </Label>
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="p-nome">Nome interno</Label>
              <Input
                id="p-nome"
                value={r.nome}
                maxLength={80}
                onChange={(e) => set('nome', e.target.value)}
                placeholder="Ana — SDR construtoras SP"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-exibicao">Nome de exibição</Label>
              <Input
                id="p-exibicao"
                value={r.nome_exibicao}
                maxLength={60}
                onChange={(e) => set('nome_exibicao', e.target.value)}
                placeholder="Ana"
              />
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={r.tipo} onValueChange={(v) => set('tipo', v as Rascunho['tipo'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sdr">SDR — marca reuniões</SelectItem>
                  <SelectItem value="originador">Originador — origina NFs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Gênero gramatical</Label>
              <Select
                value={r.genero_gramatical}
                onValueChange={(v) => set('genero_gramatical', v as Rascunho['genero_gramatical'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="feminino">Feminino (“obrigada”)</SelectItem>
                  <SelectItem value="masculino">Masculino (“obrigado”)</SelectItem>
                  <SelectItem value="neutro">Neutro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="p-tom">Tom</Label>
            <Textarea
              id="p-tom"
              rows={3}
              maxLength={400}
              value={r.tom}
              onChange={(e) => set('tom', e.target.value)}
              placeholder="Cordial e direta, sem gírias; frases curtas no WhatsApp."
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-bio">Bio curta</Label>
            <Textarea
              id="p-bio"
              rows={3}
              maxLength={400}
              value={r.bio_curta}
              onChange={(e) => set('bio_curta', e.target.value)}
              placeholder="Atendo construtoras interessadas em antecipar recebíveis."
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="p-assinatura">Assinatura de e-mail</Label>
          <Textarea
            id="p-assinatura"
            rows={3}
            maxLength={800}
            value={r.assinatura_email}
            onChange={(e) => set('assinatura_email', e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          A política de identificação (Configurações) vale para todas as personas: nenhuma afirma ser
          humana nem inventa vida pessoal, seja qual for o tom escrito aqui.
        </p>
      </Secao>

      {/* ─── Canais ─────────────────────────────────────────────────────── */}
      <Secao
        titulo="Por onde fala"
        descricao="Cada agente tem a SUA linha de WhatsApp — toda mensagem dele sai por ela. Uma linha só pode ser de um agente ativo."
      >
        {contasIa.length === 0 ? (
          <Aviso>
            <p className="font-medium">Hoje existem 0 contas de WhatsApp do tipo IA.</p>
            <p>
              Um agente não pode ficar autônomo sem linha própria — a gravação é recusada, em vez de
              falhar no envio horas depois sem ninguém ver. Cadastre uma conta do tipo “IA” em{' '}
              <Link href="/comunicacao/config" className="font-medium underline underline-offset-2">
                Comunicação › Contas de WhatsApp
              </Link>{' '}
              e volte aqui para escolhê-la. Enquanto isso, dá para salvar o agente com a autonomia desligada.
            </p>
          </Aviso>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Linha de WhatsApp</Label>
            <Select
              value={r.whatsapp_conta_id ?? NENHUM}
              onValueChange={(v) => set('whatsapp_conta_id', v === NENHUM ? null : v)}
              disabled={contasIa.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sem linha" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>Sem linha</SelectItem>
                {contasIa.map((c) => {
                  const dono = donoDaLinha(c.id)
                  return (
                    <SelectItem key={c.id} value={c.id} disabled={Boolean(dono) || !c.ativo}>
                      {c.apelido} · {c.numero}
                      {!c.ativo ? ' (inativa)' : ''}
                      {dono ? ` — em uso por ${dono.nome}` : ''}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {contasIa.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Linhas já usadas por outro agente ativo aparecem bloqueadas, com o nome dele.
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-voz">Conta de voz (Ana)</Label>
            <Input
              id="p-voz"
              value={r.voz_conta_id}
              maxLength={120}
              onChange={(e) => set('voz_conta_id', e.target.value)}
              placeholder="Identificador da persona na Ana"
            />
            <p className="text-xs text-muted-foreground">Sem conta de voz, o agente não liga — só escreve.</p>
          </div>

          <CaixaEmailCampo
            caixas={caixas}
            agentes={agentes}
            agenteId={agente?.id ?? null}
            valor={r.email_caixa_id}
            onChange={(v) => set('email_caixa_id', v)}
          />

          <div className="space-y-1">
            <Label htmlFor="p-remetente">Remetente pelo Resend (alternativa)</Label>
            <Input
              id="p-remetente"
              type="email"
              value={r.email_remetente}
              maxLength={200}
              onChange={(e) => set('email_remetente', e.target.value)}
              placeholder="ana@oneos.com.br"
            />
            <p className="text-xs text-muted-foreground">
              Usado quando não há caixa conectada: o e-mail sai, mas a resposta não volta para o agente.
            </p>
          </div>
        </div>
      </Secao>

      {/* ─── Closer ─────────────────────────────────────────────────────── */}
      <Secao
        titulo="Para quem entrega"
        descricao="As reuniões que um SDR de IA marca vão para a agenda do closer designado. O substituto cobre férias e agenda cheia dentro do horizonte de agendamento."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Closer designado</Label>
            <Select
              value={r.closer_id ?? NENHUM}
              onValueChange={(v) => set('closer_id', v === NENHUM ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Nenhum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>Nenhum</SelectItem>
                {closers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Substituto</Label>
            <Select
              value={r.closer_substituto_id ?? NENHUM}
              onValueChange={(v) => set('closer_substituto_id', v === NENHUM ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Nenhum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>Nenhum</SelectItem>
                {closers
                  .filter((c) => c.id !== r.closer_id)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                      {c.ausente_ate && c.ausente_ate >= hoje ? ` (ausente até ${dataCurta(c.ausente_ate)})` : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {closers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum closer humano ativo (vendedor do tipo “vendedor”) encontrado no Comercial.
          </p>
        ) : null}
        {closerAusente ? (
          <Aviso tom="info">
            {closer?.nome} está ausente até {dataCurta(closerAusente)}. Até lá o agente marca com o
            substituto{r.closer_substituto_id ? '' : ' — que ainda não foi escolhido'}.
          </Aviso>
        ) : null}
        {r.tipo === 'sdr' && !r.closer_id ? (
          <Aviso>Um SDR sem closer designado não consegue marcar reunião: a RPC de agendamento recusa.</Aviso>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Trocar o closer não encerra mandatos em andamento: as reuniões já marcadas ficam onde estão, as
          próximas vão para o novo.
        </p>
      </Secao>

      {/* ─── Escopo ─────────────────────────────────────────────────────── */}
      <Secao
        titulo="Onde pode trabalhar"
        descricao="O escopo diz ONDE este agente pode trabalhar; as regras de mandato (Configurações) dizem O QUE ele recebe dentro disso."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Modo do escopo</Label>
            <Select
              value={r.modo_escopo}
              onValueChange={(v) => set('modo_escopo', v as Rascunho['modo_escopo'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="filtro">Filtro — trabalha o que cai no filtro</SelectItem>
                <SelectItem value="carteira" disabled={!carteiraHabilitada}>
                  Carteira — entra no rodízio como um humano{carteiraHabilitada ? '' : ' (desligado)'}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="self-end text-xs text-muted-foreground">
            O modo carteira já está implementado e fica desligado por decisão (Configurações › “Modo
            carteira”). No modo filtro o agente não recebe distribuição de leads nem de notas.
          </p>
        </div>

        {principalNf ? filtrosNotas : filtrosEmpresas}
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {principalNf
              ? 'Filtros por empresa (para mandatos de reunião, qualificação e reativação)'
              : 'Filtros por nota fiscal (para mandatos de originação)'}
          </summary>
          <div className="mt-3">{principalNf ? filtrosEmpresas : filtrosNotas}</div>
        </details>
      </Secao>

      {/* ─── Rodagem e cotas ────────────────────────────────────────────── */}
      <Secao
        titulo="Quanto pode fazer"
        descricao="Piloto limita A QUEM (o filtro de piloto por cima do escopo); a cota limita QUANTO (volume por dia). As duas cercas valem juntas."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Modo de rodagem</Label>
            <Select value={r.modo_rodagem} onValueChange={(v) => set('modo_rodagem', v as ModoRodagem)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="piloto">Piloto — escopo E filtro de piloto</SelectItem>
                <SelectItem value="pleno">Pleno — o escopo inteiro</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Comece em piloto, onde errar é barato; passe a pleno depois de ler o desempenho.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-gasto">Gasto diário máximo (R$)</Label>
            <Input
              id="p-gasto"
              inputMode="decimal"
              value={r.gasto_diario}
              onChange={(e) => set('gasto_diario', e.target.value)}
              placeholder="0,00"
            />
            <p className="text-xs text-muted-foreground">0 = sem teto próprio; vale só o teto mensal global.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COTAS.map((c) => (
            <div key={c.chave} className="space-y-1">
              <Label htmlFor={`cota-${c.chave}`} className="text-xs">
                {c.rotulo}
              </Label>
              <Input
                id={`cota-${c.chave}`}
                inputMode="numeric"
                value={r.cotas[c.chave] ?? ''}
                onChange={(e) => setR((a) => ({ ...a, cotas: { ...a.cotas, [c.chave]: e.target.value } }))}
              />
              {c.nota ? <p className="text-[11px] text-muted-foreground">{c.nota}</p> : null}
            </div>
          ))}
        </div>
      </Secao>

      {/* ─── Autonomia ──────────────────────────────────────────────────── */}
      <Secao titulo="Ligado ou desligado">
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-10">
          <label className="flex items-center gap-3">
            <Switch checked={r.autonomo} onCheckedChange={(v) => set('autonomo', v)} />
            <span className="text-sm">
              <span className="font-medium">Autônomo</span>
              <span className="block text-xs text-muted-foreground">Age sozinho dentro das cercas. Desligado = cadastrado, mas parado.</span>
            </span>
          </label>
          <label className="flex items-center gap-3">
            <Switch checked={r.ativo} onCheckedChange={(v) => set('ativo', v)} />
            <span className="text-sm">
              <span className="font-medium">Ativo</span>
              <span className="block text-xs text-muted-foreground">Inativo some das regras e libera a linha de WhatsApp.</span>
            </span>
          </label>
        </div>
        {r.autonomo && r.ativo && semLinhaBoa ? (
          <Aviso tom="critical">
            Autonomia exige uma linha de WhatsApp própria e ativa. Do jeito que está, salvar será
            recusado — escolha a linha acima ou desligue a autonomia.
          </Aviso>
        ) : null}
        <div className="flex justify-end">
          <Button disabled={salvando || enviandoFoto} onClick={() => void salvar()}>
            <Save className="mr-2 h-4 w-4" aria-hidden />
            {salvando ? 'Salvando…' : agente ? 'Salvar persona' : 'Criar agente'}
          </Button>
        </div>
      </Secao>
    </div>
  )
}
