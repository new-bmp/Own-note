import type { Board, AgentBrief } from '../src/model'
export const defaultAgentBrief: AgentBrief
export function editAgentBrief(project: Board, patch: Partial<AgentBrief>): Board
export function validAgentBrief(value: unknown): value is AgentBrief
