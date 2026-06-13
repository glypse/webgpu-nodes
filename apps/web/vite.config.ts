import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		noExternal: ["paneforge", "svelte-toolbelt", "runed"]
	},
	resolve: {
		alias: {
			// This allows the @org/editor package to use `$editor` like this web app uses `$lib`,
			// and still work in this web app dev mode.
			$editor: path.resolve(__dirname, "../../packages/editor/src/lib")
		}
	}
});
