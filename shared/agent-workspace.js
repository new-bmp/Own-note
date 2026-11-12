export function migrateAgentProjects(notebook){
  if(!notebook)return notebook
  let changed=false
  const projects=[...(notebook.agentProjects||[])]
  const boards=notebook.boards.map(board=>{
    const moved=board.notes.filter(note=>note.kind==='concept'||note.source?.section==='agent-plan')
    if(!moved.length)return board
    changed=true
    const ids=new Set(moved.map(note=>note.id))
    let project=projects.find(p=>p.legacyBoardId===board.id)
    if(!project){let id='agent-'+board.id.slice(0,112),suffix=1;while([...notebook.boards,...projects].some(p=>p.id===id))id='agent-'+board.id.slice(0,112)+'-'+suffix++;project={id,legacyBoardId:board.id,title:board.title+' · Agent',description:board.description,icon:'project',favorite:false,trashed:board.trashed,updatedAt:board.updatedAt,notes:[],connections:[],agents:[]};projects.push(project)}
    const existing=new Set(project.notes.map(note=>note.id))
    project={...project,notes:[...project.notes,...moved.filter(note=>!existing.has(note.id))],connections:[...project.connections,...board.connections.filter(edge=>ids.has(edge.from)&&ids.has(edge.to)&&!project.connections.some(current=>current.id===edge.id))],agents:board.agents||project.agents}
    projects[projects.findIndex(p=>p.id===project.id)]=project
    return {...board,notes:board.notes.filter(note=>!ids.has(note.id)),connections:board.connections.filter(edge=>!ids.has(edge.from)&&!ids.has(edge.to)),agents:undefined}
  })
  return changed?{...notebook,boards,agentProjects:projects,activeAgentProjectId:notebook.activeAgentProjectId||projects[0]?.id}:notebook
}
