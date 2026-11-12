import type { Board } from '../src/model'
export function canvasHierarchyError(boards: Board[]): string
export function boardTrail(boards: Board[], id: string): Board[]
export function boardSubtree(boards: Board[], id: string): Board[]
export function orderedBoards(boards: Board[]): Board[]
export function copyBoardTree(boards: Board[], nextId: () => string): Board[]
