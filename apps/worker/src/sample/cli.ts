import { sessaoDedicada, pool } from '../db.js'
import { logger } from '../logger.js'
import { abrirIngestao, concluirIngestao, falharIngestao } from '../ingestoes.js'
import { ingerirReceita } from '../jobs/receita.js'
import { ingerirCno } from '../jobs/cno.js'
import { rodarDerivadas } from '../jobs/index.js'

/**
 * `pnpm --filter @jobsiteos/worker sample`
 *
 * The whole pipeline, end to end, against the real database, in about ten seconds
 * and without downloading a single byte: fixtures → zip → latin-1 → csv-parse →
 * COPY → upsert → SPE → grupos → métricas → reclassificação → promoção → CNO →
 * reclassificação again. Everything except the download itself is the same code
 * the monthly run executes.
 *
 * It writes to whatever DATABASE_URL points at. Point it at a Supabase BRANCH, not
 * at production, unless you mean to.
 */
async function main(): Promise<void> {
  const client = await sessaoDedicada()

  // ── Receita ───────────────────────────────────────────────────────────────
  const idReceita = await abrirIngestao('receita_cnpj', { sample: true })
  logger.info({ ingestao: idReceita }, '── Ingestão Receita (amostra) ──')

  try {
    const receita = await ingerirReceita(client, idReceita, { sample: true })
    const derivadas = await rodarDerivadas(client)
    await concluirIngestao(
      idReceita,
      'receita_cnpj',
      {
        linhas_processadas: receita.linhas_processadas,
        linhas_novas: receita.linhas_novas,
        linhas_atualizadas: receita.linhas_atualizadas,
      },
      { receita, derivadas, sample: true },
    )
  } catch (erro) {
    await falharIngestao(idReceita, 'receita_cnpj', erro)
    throw erro
  }

  // ── CNO ───────────────────────────────────────────────────────────────────
  const idCno = await abrirIngestao('cno', { sample: true })
  logger.info({ ingestao: idCno }, '── Ingestão CNO (amostra) ──')

  try {
    const cno = await ingerirCno(client, idCno, { sample: true })
    // The obras are a SOM signal, so the pyramid moves again — DELTA ENGENHARIA
    // reaches SOM only here, and only because of its active obra.
    const derivadas = await rodarDerivadas(client)
    await concluirIngestao(
      idCno,
      'cno',
      {
        linhas_processadas: cno.linhas_processadas,
        linhas_novas: cno.linhas_novas,
        linhas_atualizadas: cno.linhas_atualizadas,
      },
      { cno, derivadas, sample: true },
    )
  } catch (erro) {
    await falharIngestao(idCno, 'cno', erro)
    throw erro
  }

  await resumo(client)
  await client.end()
  await pool.end()
}

async function resumo(client: Awaited<ReturnType<typeof sessaoDedicada>>): Promise<void> {
  const { rows: piramide } = await client.query<{ camada: string; total: number }>(
    `select camada, count(*)::int as total
     from mercado_universo
     group by camada
     order by array_position(array['universo','tam','sam','som'], camada)`,
  )

  const { rows: empresas } = await client.query<{
    razao_social: string | null
    camada: string | null
    estagio: string
    origem: string | null
  }>(
    `select razao_social, camada, estagio, origem
     from empresas
     where origem = 'mercado'
     order by camada desc, razao_social`,
  )

  const { rows: grupos } = await client.query<{ nome: string | null; membros: number; spes: number }>(
    `select g.nome,
            count(distinct u.cnpj_raiz)::int as membros,
            count(*) filter (where u.is_spe)::int as spes
     from grupos_economicos g
     join mercado_universo u on u.grupo_id = g.id
     group by g.id, g.nome`,
  )

  /* eslint-disable no-console */
  console.log('\n── Pirâmide ────────────────────────────────')
  console.table(piramide)
  console.log('── Promovidas para empresas ────────────────')
  console.table(empresas)
  console.log('── Grupos econômicos ───────────────────────')
  console.table(grupos)
  console.log(
    [
      '',
      'Esperado (12 linhas no universo):',
      '  SOM      4 — ALFA CONSTRUTORA matriz e filial (grupo_spes_24m = 2), SPE ALFA 01,',
      '               e DELTA ENGENHARIA matriz, que só chega ao SOM pela obra ativa no CNO.',
      '  SAM      2 — BETA (capital ≥ 2M em SC) e a filial da DELTA, que não tem obra própria:',
      '               obra é do estabelecimento, não da raiz.',
      '  TAM      1 — EPSILON: perfil perfeito, mas AM está fora da geografia do SAM.',
      '  UNIVERSO 5 — a holding ALFA PARTICIPACOES (CNAE 6462: entrou SÓ pela segunda passada',
      '               de sócios-PJ), as duas SPEs recentes (< 3 anos), GAMA e a ZETA baixada.',
      '',
      'Promovidas: 4 — só matrizes. Uma filial não é uma empresa para vender, é a mesma',
      'empresa com outro sufixo (qtd_filiais já carrega esse fato).',
      '',
    ].join('\n'),
  )
  /* eslint-enable no-console */
}

main().catch((erro: unknown) => {
  logger.error({ erro: String(erro) }, 'A amostra falhou.')
  process.exitCode = 1
  void pool.end()
})
