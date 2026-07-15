import type pg from 'pg'
import { logger } from '../logger.js'

/**
 * SPE detection (§3.2.1).
 *
 * A "Sociedade de Propósito Específico" is the vehicle an incorporadora opens per
 * building. It matters because the incorporadora is not one company: it is a
 * holding plus dozens or hundreds of SPEs, and counting the CNPJ alone
 * underestimates the account by two orders of magnitude. SPEs opened in the last
 * 24 months are also the single best proxy for launch velocity — i.e. for who is
 * about to need software.
 *
 * The primary signal is structural, per the spec: a sócio-PJ that is itself an
 * incorporadora/construtora inside the cut (CNAE 41/42/43). The textual signals
 * only REINFORCE it — a company called "SPE ALPHA 3 EMPREENDIMENTO IMOBILIÁRIO"
 * is an SPE whether or not its QSA made it into this month's dump.
 *
 * Rejected: keying off natureza jurídica alone. There is no "SPE" natureza — they
 * are ordinary 2062 sociedades limitadas — so it would flag half the country.
 */

/** Standalone words only: "SPE 3" is an SPE, "ESPECIALIZADA" is not. */
const PADRAO_SPE = String.raw`(^|[^A-Z])SPE([^A-Z]|$)|SOCIEDADE DE PROPOSITO ESPECIFICO|SOCIEDADE DE PROPÓSITO ESPECÍFICO`
/** Numbered project vehicles: "EMPREENDIMENTO IMOBILIARIO 12", "INCORPORACAO 4 LTDA". */
const PADRAO_EMPREENDIMENTO = String.raw`(EMPREENDIMENTO|INCORPORACAO|INCORPORAÇÃO)`

export async function detectarSpes(client: pg.ClientBase): Promise<number> {
  const { rowCount } = await client.query(
    `with socio_construtor as (
       -- sócio-PJ whose own CNPJ raiz is a construtora/incorporadora in the cut
       select distinct s.cnpj
       from mercado_socios s
       join mercado_universo mae
         on mae.cnpj_raiz = left(regexp_replace(s.cpf_cnpj_socio, '\\D', '', 'g'), 8)
       where s.tipo_socio = 'PJ'
         and length(regexp_replace(s.cpf_cnpj_socio, '\\D', '', 'g')) = 14
         and mae.cnae_grupos && array['41', '42', '43']
         -- a company is not its own parent
         and mae.cnpj_raiz <> left(s.cnpj, 8)
     ),
     calculado as (
       select
         u.cnpj,
         (
           exists (select 1 from socio_construtor sc where sc.cnpj = u.cnpj)
           or upper(coalesce(u.razao_social, '')) ~ $1
           or (
             upper(coalesce(u.razao_social, '')) ~ $2
             and coalesce(u.razao_social, '') ~ '[0-9]'
           )
         ) as is_spe
       from mercado_universo u
     )
     update mercado_universo u
     set is_spe = c.is_spe
     from calculado c
     where c.cnpj = u.cnpj
       and u.is_spe is distinct from c.is_spe`,
    [PADRAO_SPE, PADRAO_EMPREENDIMENTO],
  )

  // Promoted companies carry the flag too — the Company 360 shows it.
  await client.query(
    `update empresas e
     set is_spe = u.is_spe
     from mercado_universo u
     where u.cnpj = e.cnpj and e.is_spe is distinct from u.is_spe`,
  )

  const alteradas = rowCount ?? 0
  logger.info({ alteradas }, 'Detecção de SPEs concluída.')
  return alteradas
}
