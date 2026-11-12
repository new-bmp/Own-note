import type { ChartSpec } from '../src/model'
export function chartGrid(chart:ChartSpec):string[][]
export function clipboardGrid(text:string):string[][]
export function chartFromGrid(grid:string[][],type?:ChartSpec['type'],unit?:string):ChartSpec
