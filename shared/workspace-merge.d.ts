import type { Notebook } from '../src/model'
export class MergeConflict extends Error {}
export function mergeWorkspaces(base:Notebook,local:Notebook,remote:Notebook):Notebook
