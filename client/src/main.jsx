import 'bootstrap/dist/css/bootstrap.min.css';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ConfirmDialogHost from './components/ConfirmDialogHost.jsx'
import ModalAccessibilityManager from './components/ModalAccessibilityManager.jsx'
import ChangelogButton from './components/ChangelogButton.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ModalAccessibilityManager />
    <ConfirmDialogHost />
    <ChangelogButton />
    <App />
  </StrictMode>,
)
