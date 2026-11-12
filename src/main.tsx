import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { loadNotebook } from './storage'
import './styles.css'
import './work.css'
import './theme.css'
import 'katex/dist/katex.min.css'
import './rich.css'
import './authoring.css'
import './workbench.css'
import './presentation.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
void loadNotebook().then((notebook) =>
  root.render(
    <React.StrictMode>
      <App initialNotebook={notebook} />
    </React.StrictMode>,
  ),
)
