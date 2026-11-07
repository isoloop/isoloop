/* `./checkbox` rendered into the subset. */
import { container } from './subset';
import { render } from 'preact';
import { Checkbox } from './checkbox';

render(<Checkbox />, container);
