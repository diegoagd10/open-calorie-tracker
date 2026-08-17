import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(`Authentication mock API listening on http://localhost:${port}`);
});
