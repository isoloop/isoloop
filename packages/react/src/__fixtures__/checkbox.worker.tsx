/* `./checkbox` rendered into the subset. */
import { container } from './subset';
import { createRoot } from 'react-dom/client';
import { Checkbox } from './checkbox';

createRoot(container).render(<Checkbox />);
