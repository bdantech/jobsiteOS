import { View } from 'react-native'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { Field, FieldPair } from './field'
import {
  formatData,
  formatM2,
  formatMoeda,
  formatNumero,
  idadeAnos,
  porteLabel,
} from './format'
import type { Metricas, UniversoRegistro } from './types'

function endereco(universo: UniversoRegistro): string | null {
  const rua = [universo.logradouro, universo.numero].filter(Boolean).join(', ')
  const partes = [rua, universo.bairro, universo.cep].filter((parte) => Boolean(parte))
  return partes.length > 0 ? partes.join(' · ') : null
}

/** Everything the Receita Federal dump says about this CNPJ. */
export function UniversoCadastro({ universo }: { universo: UniversoRegistro }) {
  const idade = idadeAnos(universo.data_inicio_atividade)
  const secundarios = universo.cnaes_secundarios ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cadastro (Receita Federal)</CardTitle>
      </CardHeader>

      <CardContent className="gap-3">
        <FieldPair
          left={{ label: 'CNAE principal', value: universo.cnae_principal }}
          right={{ label: 'Porte', value: porteLabel(universo.porte_rfb) }}
        />

        <FieldPair
          left={{ label: 'Capital social', value: formatMoeda(universo.capital_social) }}
          right={{
            label: 'Início de atividade',
            value: formatData(universo.data_inicio_atividade),
          }}
        />

        <FieldPair
          left={{ label: 'Idade', value: idade === null ? null : `${idade} ano(s)` }}
          right={{ label: 'Natureza jurídica', value: universo.natureza_juridica }}
        />

        <FieldPair
          left={{
            label: 'Optante do Simples',
            value: universo.opcao_simples === null ? null : universo.opcao_simples ? 'Sim' : 'Não',
          }}
          right={{
            label: 'Saiu do Simples em',
            value: formatData(universo.data_exclusao_simples),
          }}
        />

        <Field label="Endereço" value={endereco(universo)} />

        <FieldPair
          left={{ label: 'Telefone', value: universo.telefone1_rfb }}
          right={{ label: 'E-mail', value: universo.email_rfb }}
        />

        {secundarios.length > 0 ? (
          <Field label="CNAEs secundários" value={secundarios.join(', ')} />
        ) : null}

        {universo.situacao_motivo ? (
          <Field label="Motivo da situação" value={universo.situacao_motivo} />
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * The computed signals — written by the worker into `mercado_metricas`, not by
 * the Receita. Absent until the first metrics run touches this CNPJ, which is a
 * real state on a freshly ingested row and must not read as "zero".
 */
export function UniversoSinais({
  metricas,
  grafoSefaz,
}: {
  metricas: Metricas | null
  grafoSefaz: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sinais</CardTitle>
      </CardHeader>

      <CardContent className="gap-3">
        {metricas === null ? (
          <Text variant="muted">
            Ainda não calculados para este CNPJ. Eles são gerados após a próxima rodada de métricas.
          </Text>
        ) : (
          <View className="gap-3">
            <FieldPair
              left={{ label: 'Filiais', value: formatNumero(metricas.qtd_filiais) }}
              right={{ label: 'Obras ativas', value: formatNumero(metricas.obras_ativas) }}
            />

            <FieldPair
              left={{ label: 'm² em execução', value: formatM2(metricas.m2_em_execucao) }}
              right={{
                label: 'Obras iniciadas (24m)',
                value: formatNumero(metricas.obras_iniciadas_24m),
              }}
            />

            <FieldPair
              left={{ label: 'SPEs no grupo', value: formatNumero(metricas.grupo_spes_total) }}
              right={{
                label: 'SPEs abertas (24m)',
                value: formatNumero(metricas.grupo_spes_24m),
              }}
            />

            <FieldPair
              left={{
                label: 'Capital agregado do grupo',
                value: formatMoeda(metricas.grupo_capital_agregado),
              }}
              right={{
                label: 'UFs do grupo',
                value: metricas.grupo_ufs.length > 0 ? metricas.grupo_ufs.join(', ') : null,
              }}
            />

            <FieldPair
              left={{ label: 'Tem contato conhecido', value: metricas.tem_contato ? 'Sim' : 'Não' }}
              right={{ label: 'No grafo SEFAZ', value: grafoSefaz ? 'Sim' : 'Não' }}
            />
          </View>
        )}
      </CardContent>
    </Card>
  )
}
