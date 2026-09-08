module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      // jsxImportSource: nativewind is what turns `className` on RN components
      // into styles.
      //
      // O plugin de worklets NÃO é listado aqui de propósito: desde o SDK 54 o
      // babel-preset-expo injeta `react-native-worklets/plugin` sozinho quando o
      // pacote está instalado (build/configs/expo.js). Declará-lo à mão o
      // aplicaria duas vezes. Reanimated 4 exige o worklets como pacote separado
      // — foi por isso que ele entrou nas dependências no upgrade para o SDK 57.
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  }
}
