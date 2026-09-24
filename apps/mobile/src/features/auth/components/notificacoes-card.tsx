import { Linking, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'

import { API_BASE_URL, ApiError } from '@/lib/api'

import { mensagemDeErro } from '../api'
import { usePreferencias, usePushDispositivo, useSalvarPreferencias } from '../hooks'
import { LinhaSwitch } from './linha-switch'

/**
 * Two levels, because the data model has two and collapsing them would lie:
 *
 *  - THIS DEVICE  → an Expo token in usuarios.expo_push_tokens. Per install.
 *  - THIS ACCOUNT → prefs_notificacoes.{push_mobile, push_web}. Every device.
 *
 * notify() requires both to be true before it sends, so a single switch could
 * not represent the state: "on for this phone, off for the account" is real, and
 * a user staring at one enabled switch receiving nothing has no way to fix it.
 */
/**
 * O motivo de verdade, e não "verifique sua conexão" para tudo.
 *
 * As preferências não vêm do Supabase: vêm da API da web (`/api/me/preferencias`),
 * porque a coluna não é legível pelo app. Quando essa API não responde — o
 * servidor fora do ar, ou `EXPO_PUBLIC_API_BASE_URL` apontando para um endereço
 * que o aparelho não alcança —, a frase genérica mandava a pessoa conferir um
 * Wi-Fi que estava funcionando. Em desenvolvimento o endereço aparece na tela,
 * porque é justamente ele que precisa ser corrigido.
 */
function descricaoDoErro(error: unknown): string {
  if (error instanceof ApiError) {
    return mensagemDeErro(error, 'O servidor recusou o pedido. Tente novamente.')
  }
  return __DEV__
    ? `O app não alcançou a API em ${API_BASE_URL}. Confira se ela está no ar e se o endereço é acessível pelo aparelho.`
    : 'Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.'
}

export function NotificacoesCard() {
  const preferencias = usePreferencias()
  const salvar = useSalvarPreferencias()
  const push = usePushDispositivo()

  const ambiente = push.ambiente.data
  const prefs = preferencias.data

  const mutandoDispositivo = push.ativar.isPending || push.desativar.isPending
  const erroDispositivo = push.ativar.error ?? push.desativar.error

  const permissaoBloqueada =
    ambiente?.disponivel === true && !ambiente.concedida && !ambiente.podePerguntar

  function descricaoDispositivo(): string {
    if (!ambiente) return 'Verificando as permissões deste aparelho…'
    if (!ambiente.dispositivoFisico) {
      return 'Notificações push exigem um dispositivo físico — o simulador não as recebe.'
    }
    if (!ambiente.projetoConfigurado) {
      return 'Este aplicativo não foi configurado para notificações push. Fale com um administrador.'
    }
    if (permissaoBloqueada) {
      return 'A permissão de notificações foi negada. Libere nos ajustes do sistema para ativar.'
    }
    return 'Receba os alertas do JobsiteOS neste aparelho.'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notificações</CardTitle>
        <CardDescription>
          Escolha onde você quer ser avisado. Os alertas sempre aparecem no sino do aplicativo.
        </CardDescription>
      </CardHeader>

      <CardContent className="gap-0">
        {preferencias.isPending ? (
          <View className="gap-4 py-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </View>
        ) : preferencias.isError || !prefs ? (
          <ErrorState
            title="Não foi possível carregar suas preferências"
            description={descricaoDoErro(preferencias.error)}
            onRetry={() => void preferencias.refetch()}
            className="py-8"
          />
        ) : (
          <>
            <LinhaSwitch
              titulo="Notificações neste dispositivo"
              descricao={descricaoDispositivo()}
              value={push.ativo}
              disabled={!ambiente?.disponivel || permissaoBloqueada || !push.pronto}
              loading={mutandoDispositivo}
              onValueChange={(proximo) => {
                if (proximo) push.ativar.mutate()
                else push.desativar.mutate()
              }}
            />

            {permissaoBloqueada ? (
              <Button
                variant="outline"
                size="sm"
                className="mb-3 self-start"
                onPress={() => void Linking.openSettings()}
              >
                <Text>Abrir ajustes do sistema</Text>
              </Button>
            ) : null}

            {erroDispositivo ? (
              <Text variant="destructive" className="pb-3">
                {mensagemDeErro(
                  erroDispositivo,
                  'Não foi possível atualizar as notificações deste aparelho.',
                )}
              </Text>
            ) : null}

            <Separator />

            <LinhaSwitch
              titulo="Push no celular"
              descricao="Vale para todos os aparelhos em que você entrou."
              value={prefs.push_mobile}
              loading={salvar.isPending && salvar.variables?.push_mobile !== undefined}
              onValueChange={(push_mobile) => salvar.mutate({ push_mobile })}
            />

            <Separator />

            <LinhaSwitch
              titulo="Push no navegador"
              descricao="Notificações do JobsiteOS na versão web."
              value={prefs.push_web}
              loading={salvar.isPending && salvar.variables?.push_web !== undefined}
              onValueChange={(push_web) => salvar.mutate({ push_web })}
            />

            <Separator />

            <LinhaSwitch
              titulo="Resumo diário por e-mail"
              descricao="Às 8h, a lista dos avisos de rotina também no seu e-mail."
              value={prefs.resumo_email}
              loading={salvar.isPending && salvar.variables?.resumo_email !== undefined}
              onValueChange={(resumo_email) => salvar.mutate({ resumo_email })}
            />

            {/* The one state that silently swallows notifications: the phone is
                registered but the account channel is off. Say it out loud. */}
            {push.ativo && !prefs.push_mobile ? (
              <Text variant="muted" className="pt-3">
                Este aparelho está registrado, mas o push no celular está desligado — nada será
                enviado até você ligá-lo.
              </Text>
            ) : null}

            {salvar.isError ? (
              <Text variant="destructive" className="pt-3">
                {mensagemDeErro(salvar.error, 'Não foi possível salvar suas preferências.')}
              </Text>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
