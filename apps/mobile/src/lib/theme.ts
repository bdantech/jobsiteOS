import type { Theme } from '@react-navigation/native'
import { BRAND_ACCENT } from '@jobsiteos/core'

/**
 * O navy da marca no app: #050E40.
 *
 * É mais escuro e mais saturado que `BRAND_ACCENT` (#1e293f), que continua
 * sendo o navy da WEB. Os dois convivem de propósito enquanto a repaginação não
 * atravessa para o desktop — trocar a constante compartilhada mudaria a web
 * junto, num commit que fala do app.
 */
const BRAND_NAVY = '#050e40'

/**
 * The same tokens as global.css, as raw hex.
 *
 * NativeWind classes cover anything that renders through a styled component;
 * these are for the places that need a value instead of a class: lucide icon
 * `color`, the StatusBar, react-navigation's theme, RefreshControl, SVG `fill`,
 * and any native prop (e.g. Switch `trackColor`, tabBarActiveTintColor).
 *
 * ── Por que `primary` NÃO é BRAND_ACCENT nos dois temas ─────────────────────
 * BRAND_ACCENT é o navy #1e293f (hsl 220 35% 18%), escuríssimo. Contra o fundo
 * do tema escuro (#09090b) ele dá 1,37:1 — o piso do WCAG para um elemento de
 * interface é 3:1. Usá-lo como `primary` no escuro faria o botão primário, o
 * badge de notificação e o ÍCONE ATIVO DA TAB BAR praticamente sumirem.
 *
 * Então o matiz (220°) é o mesmo nos dois temas — a identidade se mantém — e no
 * escuro a luminosidade inverte para 66% (#7d9ad4, 7,05:1 contra o fundo).
 *
 * E como a primária clareia, `primaryForeground` ESCURECE junto: branco sobre
 * #7d9ad4 dá 2,82:1, abaixo dos 4,5:1 exigidos de texto. O par inverte junto —
 * do contrário só trocaríamos um bug de contraste por outro.
 *
 * `brand` é o navy exato em QUALQUER tema: ele funciona como superfície, não
 * como elemento sobre superfície, então o piso de contraste não se aplica.
 */
export interface ColorTokens {
  background: string
  foreground: string
  card: string
  cardForeground: string
  primary: string
  primaryForeground: string
  brand: string
  brandForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  destructive: string
  destructiveForeground: string
  border: string
  input: string
  ring: string
  /** Rampa ORDINAL da pirâmide: universo → tam → sam → som. Ver CAMADA_CHART. */
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  /** Neutro, para séries que não fazem parte da pirâmide. */
  chart5: string
}

export const COLORS: Record<'light' | 'dark', ColorTokens> = {
  light: {
    background: '#f4f6f8',
    foreground: '#171819',
    card: '#ffffff',
    cardForeground: '#171819',
    primary: '#184b90', // azul de ação — 7,4:1 sobre branco
    primaryForeground: '#ffffff',
    brand: BRAND_NAVY,
    brandForeground: '#ffffff',
    secondary: '#f4f6f8',
    secondaryForeground: '#3f4450',
    muted: '#eaf0f8',
    mutedForeground: '#6b7280',
    destructive: '#b33a3a',
    destructiveForeground: '#ffffff',
    border: '#e4e8ec',
    input: '#cbd5e1',
    ring: '#184b90',
    // claro → escuro
    chart1: '#a8b7d1', // universo — abaixo de 3:1 de propósito, sempre rotulado
    chart2: '#7590b8', // tam
    chart3: '#476390', // sam
    chart4: BRAND_ACCENT, // som — a âncora é o navy da marca
    chart5: '#7587a3', // neutro
  },
  dark: {
    background: '#09090b',
    foreground: '#fafafa', // zinc-50
    card: '#18181b', // zinc-900
    cardForeground: '#fafafa',
    primary: '#7fa9e0', // mesmo matiz do #184b90, luminosidade invertida
    primaryForeground: '#0a1430', // 6,4:1 sobre a primária clara
    brand: BRAND_NAVY, // a marca não clareia: como superfície, o navy funciona
    brandForeground: '#ffffff',
    secondary: '#27272a', // zinc-800
    secondaryForeground: '#fafafa',
    muted: '#27272a',
    mutedForeground: '#a1a1aa', // zinc-400
    destructive: '#ef4444',
    destructiveForeground: '#fafafa',
    border: '#27272a',
    input: '#27272a',
    ring: '#7d9ad4',
    // âncora INVERTIDA: escuro → claro. Uma rampa sequencial não se lê
    // espelhando o tema claro — o passo mais saliente (som) tem que ficar do
    // lado oposto ao fundo.
    chart1: '#3c4962', // universo — abaixo de 3:1 de propósito, sempre rotulado
    chart2: '#5c7099', // tam
    chart3: '#8da4c9', // sam
    chart4: '#cad9f2', // som
    chart5: '#8a95a8', // neutro
  },
}

/** react-navigation wants its own shape; keep it derived so it can't drift. */
export const NAV_THEME: Record<'light' | 'dark', Theme> = {
  light: {
    dark: false,
    colors: {
      primary: COLORS.light.primary,
      background: COLORS.light.background,
      card: COLORS.light.background,
      text: COLORS.light.foreground,
      border: COLORS.light.border,
      notification: COLORS.light.destructive,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '600' },
      heavy: { fontFamily: 'System', fontWeight: '700' },
    },
  },
  dark: {
    dark: true,
    colors: {
      primary: COLORS.dark.primary,
      background: COLORS.dark.background,
      card: COLORS.dark.background,
      text: COLORS.dark.foreground,
      border: COLORS.dark.border,
      notification: COLORS.dark.destructive,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '600' },
      heavy: { fontFamily: 'System', fontWeight: '700' },
    },
  },
}

/**
 * As opções de header compartilhadas por TODO stack do app.
 *
 * Elas moram aqui, e não dentro do <ModuleStack>, porque não são só dos módulos:
 * o stack RAIZ também empilha telas com header (Configurações e o report aberto
 * por deep link). Enquanto isto vivia só no ModuleStack, essas duas telas caíam
 * no tema padrão do React Navigation em vez dos tokens da casa — o header saía
 * com outro fundo e outro tom, e era visível ao lado de qualquer tela de módulo.
 */
export function opcoesDeHeader(colors: ColorTokens) {
  return {
    /*
     * O header de STACK também é navy — é a mesma superfície do <ScreenHeader>,
     * só que desenhada pelo react-navigation.
     *
     * Se um ficasse branco e o outro navy, empurrar uma tela (funil → ficha do
     * fornecedor) trocaria a cor do topo no meio da animação, e a pessoa leria
     * isso como "mudei de app", não "entrei num detalhe".
     *
     * `Poppins_600SemiBold` no título, e não Manrope: aqui o texto é o NOME DO
     * ITEM aberto ("Empresa no universo"), não o nome da tela. Manrope é a voz
     * do produto; o item é conteúdo.
     */
    headerStyle: { backgroundColor: colors.brand },
    headerTintColor: '#ffffff',
    headerTitleStyle: { color: '#ffffff', fontFamily: 'Poppins_600SemiBold', fontSize: 17 },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.background },
  } as const
}
