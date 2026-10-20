import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	// Tests exercise runes: Svelte's browser build, compiled for the client
	// (see vitest.environment.ts), so effects run.
	resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
	test: {
		include: ["src/**/*.test.ts"],
		environment: "./vitest.environment.ts",
		// Load Svelte through Vite (with the conditions above), not Node.
		server: { deps: { inline: ["svelte"] } },
	},
});
