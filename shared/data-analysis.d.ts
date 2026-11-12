export interface Dataset { columns: string[]; rows: string[][] }
export interface ColumnStats { name:string;count:number;missing:number;unique:number;numericCount:number;sum?:number;mean?:number;min?:number;max?:number;median?:number;std?:number }
export function parseDataset(source:string,format?:string): Dataset
export function numeric(value:string): number|undefined
export function summarize(columns:string[],rows:string[][]): ColumnStats[]
export function filterRows(rows:string[][],column:number,operator:string,value:string): string[][]
export function aggregate(rows:string[][],group:number,value:number,method?:string): {label:string;value:number}[]
export function datasetCsv(columns:string[],rows:string[][],protectFormulas?:boolean): string
