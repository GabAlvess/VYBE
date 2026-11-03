import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SnackMessage } from './SnackMessage';
import './styles.css';
import './visual-refresh.css';
import './auth-login.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <>
      <App />
      <SnackMessage />
    </>
  </React.StrictMode>,
);
