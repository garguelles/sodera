import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { EnsOwnerSetup } from './owner-setup';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><EnsOwnerSetup /></StrictMode>,
);
