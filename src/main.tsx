import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './features/auth/AuthProvider'
import { DepartmentsProvider } from './lib/departments'
import { Gate } from './features/auth/Gate'
import './styles/app.css'
import './i18n'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gate>
      <AuthProvider>
        <DepartmentsProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </DepartmentsProvider>
      </AuthProvider>
    </Gate>
  </React.StrictMode>
)
