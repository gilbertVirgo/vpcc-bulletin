import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // 5173 = auth hub, 5174 = sunday-sheets in local dev.
  server: { port: 5175, strictPort: true },
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        people: resolve(import.meta.dirname, "people.html"),
      },
    },
  },
});
