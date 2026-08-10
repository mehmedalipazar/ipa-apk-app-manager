import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { RouterProvider } from './router.tsx';
import { ToastProvider } from './components/Toast.tsx';
import './styles.css';

const kok = document.getElementById('root');
if (!kok) throw new Error('#root bulunamadi');

createRoot(kok).render(
  <StrictMode>
    <RouterProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </RouterProvider>
  </StrictMode>,
);
