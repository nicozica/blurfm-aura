import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://play.blurfm.com",
  output: "static",
  server: {
    host: true
  }
});
