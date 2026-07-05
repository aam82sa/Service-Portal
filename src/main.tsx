import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './features/auth/AuthProvider'
import { Gate } from './features/auth/Gate'
import './styles/app.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gate>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Gate>
  </React.StrictMode>
)
