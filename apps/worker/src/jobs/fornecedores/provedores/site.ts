import dns from 'node:dns/promises'
import { fetch } from 'undici'
import { normalizarDominio } from '../../../../../../packages/core/src/radar/dominio.js'
import { normalizarTelefoneBr } from '../../../../../../packages/core/src/fornecedores/telefone.js'
import type { ContatoDeProvedor } from '../../../../../../packages/core/src/fornecedores/provedores.js'
import { logger } from '../../../logger.js'
import type { CadastralFornecedor } from '../descoberta.js'

/**
 * Etapa 4 da camada automática (§4.1.4): quando o domínio resolve, LER a página de
 * contato.
 *
 * A cascata de domínio do Radar já descobre o domínio; o que ela não faz é abrir o
 * site. Para PME isso é metade do valor — o telefone da serralheria está no rodapé
 * de `/contato`, não numa base de dados —, e custa uma requisição HTTP.
 *
 * ─── CONFIANÇA MÉDIA, E POR QUÊ ──────────────────────────────────────────────
 *
 * A página é da empresa, então o número é dela. Mas um site pode estar desatualizado
 * por anos sem que nada indique isso, enquanto o `emit` da NF-e foi declarado à
 * SEFAZ na semana passada. "Alta" fica reservado ao que tem data.
 */

const CAMINHOS = ['/contato', '/fale-conosco', '/contatos', '/'] as const

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const RE_TEL = /(?:\(\d{2}\)\s?|\b\d{2}\s)\d{4,5}[-.\s]?\d{4}\b/g
const RE_WHATS = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\d{10,13})/g
const RE_INSTA = /instagram\.com\/([A-Za-z0-9_.]{3,30})/g

/** Assets e tracking pixels usam e-mails de terceiros; nada disso é da empresa. */
const DOMINIOS_DE_TERCEIRO = /wixpress|sentry|godaddy|wordpress|example|sentry\.io|domain\.com/i

async function baixar(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'JobsiteOS-Fornecedores/1.0' },
    })
    if (!res.ok) return null
    const tipo = res.headers.get('content-type') ?? ''
    if (!tipo.includes('html') && tipo !== '') return null
    // 300 KB é folgado para uma página de contato e curto o bastante para não deixar
    // um site com um PDF embutido segurar o job.
    return (await res.text()).slice(0, 300_000)
  } catch {
    return null
  }
}

export async function lerPaginaDeContato(
  cadastral: CadastralFornecedor,
): Promise<{ contatos: ContatoDeProvedor[]; motivo?: string }> {
  const dominio = normalizarDominio(cadastral.dominio)
  if (!dominio) return { contatos: [], motivo: 'Sem domínio resolvido.' }

  try {
    await dns.resolve(dominio)
  } catch {
    return { contatos: [], motivo: `O domínio ${dominio} não resolve no DNS.` }
  }

  const achados: ContatoDeProvedor[] = []
  const vistos = new Set<string>()

  const push = (c: ContatoDeProvedor): void => {
    const chave = `${c.tipo}|${c.valor}`
    if (vistos.has(chave)) return
    vistos.add(chave)
    achados.push(c)
  }

  for (const caminho of CAMINHOS) {
    const url = `https://${dominio}${caminho}`
    const html = await baixar(url)
    if (!html) continue

    for (const m of html.matchAll(RE_EMAIL)) {
      const e = m[0].toLowerCase()
      if (DOMINIOS_DE_TERCEIRO.test(e)) continue
      if (/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(e)) continue
      push({
        tipo: 'email',
        valor: e,
        original: m[0],
        nome_pessoa: null,
        cargo: null,
        confianca: 'media',
        evidencia: url,
      })
    }

    for (const m of html.matchAll(RE_WHATS)) {
      const tel = normalizarTelefoneBr(m[1] ?? '', { dddPadrao: cadastral.ddd })
      if (!tel.e164) continue
      // O link `wa.me` é a única evidência DIRETA de WhatsApp que existe sem
      // perguntar a um provedor: a empresa publicou o próprio número como canal.
      push({
        tipo: 'whatsapp',
        valor: tel.e164,
        original: m[0],
        nome_pessoa: null,
        cargo: null,
        confianca: 'alta',
        evidencia: url,
      })
    }

    for (const m of html.matchAll(RE_TEL)) {
      const tel = normalizarTelefoneBr(m[0], { dddPadrao: cadastral.ddd })
      if (!tel.e164) continue
      push({
        tipo: 'telefone',
        valor: tel.e164,
        original: m[0],
        nome_pessoa: null,
        cargo: null,
        confianca: 'media',
        evidencia: url,
      })
    }

    for (const m of html.matchAll(RE_INSTA)) {
      const perfil = (m[1] ?? '').toLowerCase()
      if (['p', 'reel', 'explore', 'accounts'].includes(perfil)) continue
      push({
        tipo: 'instagram',
        valor: perfil,
        original: m[0],
        nome_pessoa: null,
        cargo: null,
        confianca: 'media',
        evidencia: url,
      })
    }

    // Achou na página de contato: não precisa varrer a home.
    if (achados.length > 0 && caminho !== '/') break
  }

  if (achados.length === 0) {
    logger.info({ cnpj: cadastral.cnpj, dominio }, 'Site respondeu, mas não trouxe contato.')
  }
  return { contatos: achados }
}
