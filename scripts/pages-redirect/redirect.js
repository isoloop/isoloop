// isoloop.github.io/isoloop/ used to serve the four-loops demo. The site now
// lives at isoloop.dev: send every old address there, keeping the query and
// the hash. A same-origin file, not an inline script, so it runs under
// `script-src 'self'`; the meta refresh covers browsers without JS.
location.replace(`https://isoloop.dev/${location.search}${location.hash}`);
