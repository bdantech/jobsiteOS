import { writeFileSync } from 'node:fs'
import { gerarPdfSemanal } from './dist/apps/worker/src/jobs/reports/pdf.js'
import { r } from './fixture.mjs'

const resumo =
  'A semana fechou acima do ritmo em volume: R$ 9,8 mi convertidos contra uma média semanal ' +
  'de R$ 3,0 mi, com 232 operações de 198 cedentes. A régua tem três meses de base.\n\n' +
  'Preocupa o funil comercial: 15 leads distribuídos e nenhum contatado. E R$ 116 mi em notas ' +
  'expiraram sem trabalho, mais que o dobro da média semanal.\n\n' +
  'Onde agir: RIBEIRO CARAM tem R$ 6,4 mi de limite ocioso e o report pede atenção. As 15 ' +
  'maiores contas sem certificado escondem R$ 33,7 mi de NF por mês.'

const buf = await gerarPdfSemanal(r, resumo)
writeFileSync(new URL('./report.pdf', import.meta.url), buf)
console.log('PDF gerado:', buf.length, 'bytes')
