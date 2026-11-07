/* The smoke fixture for Preact (M3a task 3): `./app` rendered into the subset. */
import { container } from './subset';
import { render } from 'preact';
import { App } from './app';

render(<App />, container);
