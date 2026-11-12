import type { CanvasNote, AgentPresence, ConceptState, Board } from '../src/model'
export function conceptSpec(note: CanvasNote): object
export function conceptReady(note: CanvasNote, notes: CanvasNote[]): boolean
export function dependenciesDone(note: CanvasNote, notes: CanvasNote[]): boolean
export function conceptDependencyError(notes: CanvasNote[]): string
export function restoreAgentActivity(board: Board): Board
export function agentOnline(agent: AgentPresence, now?: number): boolean
export function validConcept(value: unknown): value is ConceptState
