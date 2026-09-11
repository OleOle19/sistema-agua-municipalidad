import 'bootstrap/dist/css/bootstrap.min.css';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ModalAccessibilityManager from './components/ModalAccessibilityManager.jsx'
import ChangelogButton from './components/ChangelogButton.jsx'
import AppDialogHost from './components/AppDialogHost.jsx'

const showChangelog = !/^\/manual(?:\/|$)/i.test(window.location.pathname)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ModalAccessibilityManager />
    {showChangelog && <ChangelogButton />}
    <App />
    <AppDialogHost />
  </StrictMode>,
)
