import type { ChartSpec } from '../src/model'
export const chartColors: string[]
export function validChart(value: unknown): value is ChartSpec
export function validateLatex(source: string): string
export function validateDiagramSource(source: string): void
