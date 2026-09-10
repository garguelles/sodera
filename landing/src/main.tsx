import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import './styles.css';

const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <main>
        <h1>sodera.xyz</h1>
      </main>
    ),
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
