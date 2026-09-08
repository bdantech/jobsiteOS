/**
 * `import '../global.css'` no app/_layout.tsx.
 *
 * Quem resolve isso em runtime é o Metro, via `withNativeWind({ input: './global.css' })`:
 * o arquivo vira as folhas de estilo que o `className` consulta, e o import existe só
 * pelo efeito colateral de registrá-las. Não há valor a importar dele.
 *
 * O TypeScript precisa da declaração mesmo assim. Até a 5.x ele tolerava um import de
 * efeito colateral sem tipos; a 6.0 — que entrou no repo junto com o Expo SDK 57 —
 * passou a recusá-lo com TS2882. O NativeWind não declara `*.css` em `nativewind/types`
 * (nem o react-native-css-interop, para onde aquele arquivo aponta), então a declaração
 * é nossa.
 *
 * Vazio de propósito: declarar um `const` de exportação aqui faria `import estilos from
 * './x.css'` compilar, e não existe nada para ele receber em runtime.
 */
declare module '*.css' {}
