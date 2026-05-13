import adapter from "@sveltejs/adapter-auto";
import { type Config } from "@sveltejs/kit";

const config: Config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true)
	},
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		typescript: {
			config: (config: Record<string, unknown>) => {
				const include = (config as { include: string[] }).include;

				if (include.length) {
					const extraIncludes = [
						"../eslint.config.ts",
						"../prettier.config.ts",
						"../svelte.config.ts"
					];

					for (const extraInclude of extraIncludes) {
						if (!include.includes(extraInclude)) {
							include.push(extraInclude);
						}
					}
				}

				return config;
			}
		}
	}
};

export default config;
