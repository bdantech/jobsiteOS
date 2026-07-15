import { cn } from '@/lib/utils'

/**
 * A marca ONE OS — o símbolo, sem o logotipo "oneos".
 *
 * Extraída do SVG oficial ("Logo - Oneos - Positivo.svg"): dos 9 paths do arquivo, os 3
 * primeiros desenham o símbolo e os 6 seguintes desenham as letras. Aqui ficam só os 3.
 * As cores são as do arquivo, verbatim — NÃO são tokens de tema, porque a marca não muda
 * entre claro e escuro. Ela funciona sobre os dois fundos porque o azul-claro carrega a
 * leitura.
 *
 * A viewBox é quadrada e centrada no símbolo. O bounding box real dele é 251,3 × 298,5 —
 * mais alto que largo —, então uma viewBox colada na caixa deixaria a marca esticada em
 * qualquer container quadrado (que é todo lugar onde um ícone vive). A folga lateral é
 * calculada, não chutada.
 *
 * ESTE É UM DOS DOIS ÚNICOS LUGARES onde a marca é desenhada. O outro é
 * src/app/icon.svg (o favicon), que precisa ser um arquivo estático porque é servido
 * antes de qualquer JavaScript e não pode importar um componente React. Se a marca
 * mudar, os dois mudam juntos — e nenhum outro arquivo precisa saber.
 */

interface LogoProps {
  className?: string
  /** Descrição para leitor de tela. Use `null` quando um texto ao lado já nomeia a marca. */
  title?: string | null
}

export function Logo({ className, title = 'ONE OS' }: LogoProps) {
  return (
    <svg
      viewBox="-22.77 0.65 298.48 298.48"
      className={cn('size-8', className)}
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M92.2914 213.015C71.6532 204.06 58.2964 183.709 58.2964 161.216V57.1659C58.2964 53.6834 58.6281 50.2915 59.201 47.0201C28.5829 45.9347 0.829102 70.3417 0.829102 103.477V207.528C0.829102 230.02 14.1859 250.372 34.8241 259.327L115.734 294.407C149.804 309.181 187.508 287.608 193.734 252.769C186.92 252.528 179.985 251.05 173.186 248.096L92.2914 213.015Z"
        fill="#5B8DC4"
      />
      <path
        d="M216.754 37.3719L135.844 4.79401C101.97 -8.84921 65.3367 12.7387 59.201 47.0201C65.5478 47.2463 72.0151 48.5427 78.3769 51.1056L159.286 83.6835C180.663 92.2915 194.653 113.02 194.653 136.055V242.608C194.653 246.106 194.322 249.482 193.734 252.769C224.261 253.839 252.106 229.523 252.106 196.297V89.7438C252.121 66.7086 238.131 45.98 216.754 37.3719Z"
        fill="#184B90"
      />
      <path
        d="M194.668 136.055C194.668 113.02 180.663 92.2915 159.301 83.6835L78.3919 51.1056C72.0301 48.5427 65.5628 47.2463 59.2161 47.0201C58.6282 50.2915 58.3115 53.6835 58.3115 57.1659V161.216C58.3115 183.709 71.6683 204.06 92.3065 213.015L173.216 248.096C180.015 251.05 186.95 252.528 193.764 252.769C194.352 249.497 194.683 246.106 194.683 242.608V136.055H194.668Z"
        fill="#050E40"
      />
    </svg>
  )
}
