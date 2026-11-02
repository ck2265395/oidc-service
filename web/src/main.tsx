import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ConsoleApp } from './app/ConsoleApp';
import './styles/global.css';
import './styles/console.css';

const root = document.getElementById('root');
if (!root) throw new Error('Console root element is missing');

createRoot(root).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>,
);
