import Constants from 'expo-constants'

/**
 * A versão que a pessoa vê no rodapé, lida do app.json (`expo.version`) — a
 * mesma que vai para a loja e para o report de bug (`appVersao`). Texto fixo
 * aqui já mentiu: o 1.0.0 da App Store saía dizendo "v2.4.0".
 */
export const VERSAO_DO_APP = `v${Constants.expoConfig?.version ?? '?'}`
