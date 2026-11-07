/* The smoke fixture for React (M3a task 3): `./app` rendered into the subset. */
import { container } from './subset';
import { createRoot } from 'react-dom/client';
import { App } from './app';

createRoot(container).render(<App />);
