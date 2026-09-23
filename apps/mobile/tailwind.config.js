const plugin = require('tailwindcss/plugin')

/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind compiles these globs at build time — a class string that never
  // appears literally in this tree is never generated. No dynamic class names.
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  /*
   * `fontWeight` DESLIGADO, e o plugin abaixo ocupa o lugar dele.
   *
   * Ligado, `font-semibold` emitia as DUAS coisas: a família certa (do plugin)
   * e `font-weight: 600` (do core). Em React Native isso é pior que só o peso —
   * o Android empilha um bold sintético POR CIMA do arquivo já semibold e o
   * texto sai borrado; o iOS pode cair noutra face da família.
   *
   * As cinco classes que o app usa (medium, semibold, bold, extrabold, normal)
   * estão todas no plugin. As que o Tailwind perdeu aqui — thin, light,
   * extralight — não aparecem em nenhuma das ~30 telas, e não teriam arquivo
   * carregado para apontar de qualquer forma.
   */
  corePlugins: { fontWeight: false },
  theme: {
    extend: {
      colors: {
        // Semantic tokens, resolved from the CSS variables in global.css.
        // Same names and same zinc scale as the web app's shadcn theme, so a
        // component ported between platforms only changes its element tags.
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Superfícies de marca: o navy exato, nos dois temas. Não confundir com
        // `primary`, que clareia no escuro para sobreviver ao contraste.
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
        },
        // Rampa ORDINAL da pirâmide (universo → tam → sam → som), um matiz só.
        // chart-5 é o neutro, para séries que não fazem parte da pirâmide.
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },
      fontFamily: {
        /*
         * `sans` é o padrão de todo texto — o componente <Text> aplica
         * `font-sans` e os pesos entram por classe (`font-medium`, `font-bold`).
         *
         * Em React Native não existe synthetic bold por família: `fontWeight`
         * sobre uma fonte carregada por arquivo NÃO engrossa nada. Cada peso é
         * uma família própria, e é por isso que elas estão listadas uma a uma.
         */
        sans: ['Poppins_400Regular'],
        medium: ['Poppins_500Medium'],
        semibold: ['Poppins_600SemiBold'],
        bold: ['Poppins_700Bold'],
        extrabold: ['Poppins_800ExtraBold'],
        /* Só título de tela. Ver a nota em app/_layout.tsx. */
        display: ['Manrope_800ExtraBold'],
        'display-bold': ['Manrope_700Bold'],
      },
      borderRadius: {
        // Fixed px, not rem: RN has no root font size to scale against.
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '20px',
        '2xl': '24px',
      },
    },
  },
  plugins: [
    /*
     * PESO VIRA FAMÍLIA — e tem que ser aqui, não no componente <Text>.
     *
     * React Native não tem synthetic bold para fonte carregada por arquivo: um
     * `fontWeight: '700'` sobre Poppins_400Regular não engrossa nada no iOS, e
     * no Android cai numa família qualquer. Quem pede peso precisa receber o
     * ARQUIVO daquele peso.
     *
     * Tentei primeiro resolver isso dentro do <Text>, lendo o `style`. Não
     * funciona: o NativeWind converte `className` em estilo DENTRO do RNText,
     * depois do style que o componente passa — o peso vindo da classe nunca
     * chega ao componente para ser lido.
     *
     * Redefinindo os utilitários, cada `font-semibold` já escrito nas ~30 telas
     * passa a apontar para Poppins_600SemiBold sem que nenhuma delas mude uma
     * linha. É isso que torna a troca de tipografia segura de fazer de uma vez.
     */
    plugin(({ addUtilities }) => {
      addUtilities({
        '.font-normal': { fontFamily: 'Poppins_400Regular' },
        '.font-medium': { fontFamily: 'Poppins_500Medium' },
        '.font-semibold': { fontFamily: 'Poppins_600SemiBold' },
        '.font-bold': { fontFamily: 'Poppins_700Bold' },
        '.font-extrabold': { fontFamily: 'Poppins_800ExtraBold' },
        '.font-black': { fontFamily: 'Poppins_800ExtraBold' },
      })
    }),
  ],
}
