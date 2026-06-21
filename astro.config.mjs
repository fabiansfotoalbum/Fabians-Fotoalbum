import { defineConfig } from 'astro/config';

// Statische Seite. Passagen liegen in public/passages/ und werden direkt mitkopiert.
export default defineConfig({
  output: 'static',
});
