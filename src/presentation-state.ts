import type { Board, Notebook, Viewport } from './model'

export interface PresentationSession { boards: Board[]; boardId: string }

export function createPresentationSession(notebook: Notebook, boardId: string): PresentationSession {
  return { boards: structuredClone(notebook.boards), boardId }
}

export function movePresentationNote(session: PresentationSession, boardId: string, noteId: string, x: number, y: number): PresentationSession {
  if (![x, y].every(Number.isFinite)) return session
  return { ...session, boards: session.boards.map(board => board.id !== boardId ? board : {
    ...board, notes: board.notes.map(note => note.id !== noteId ? note : { ...note, x, y }),
  }) }
}

export function presentationFit(board: Board, width: number, height: number): Viewport {
  if (!board.notes.length) return { x: width / 2, y: height / 2, zoom: 1 }
  const left = Math.min(...board.notes.map(note => note.x)), top = Math.min(...board.notes.map(note => note.y))
  const right = Math.max(...board.notes.map(note => note.x + note.width)), bottom = Math.max(...board.notes.map(note => note.y + note.height))
  const zoom = Math.max(.05, Math.min(1.5, (width - 120) / (right - left), (height - 160) / (bottom - top)))
  return { x: (width - (right - left) * zoom) / 2 - left * zoom, y: (height - (bottom - top) * zoom) / 2 - top * zoom, zoom }
}
