import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/theme.css';

const container = document.getElementById('root');
if (!container) throw new Error('Piano Steps: the #root element is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
