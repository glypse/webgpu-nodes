import { type SvelteConfig } from "@sveltejs/vite-plugin-svelte";

const config: SvelteConfig = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true)
	}
};

export default config;
