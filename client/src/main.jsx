import 'bootstrap/dist/css/bootstrap.min.css';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ModalAccessibilityManager from './components/ModalAccessibilityManager.jsx'
import ChangelogButton from './components/ChangelogButton.jsx'
import AppDialogHost from './components/AppDialogHost.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ModalAccessibilityManager />
    <ChangelogButton />
    <App />
    <AppDialogHost />
  </StrictMode>,
)
