import { defineConfig, includeIgnoreFile } from "eslint/config";
import globals from "globals";
import ts from "typescript-eslint";

import rootConfig from "../../eslint.config";
import svelteConfig from "./svelte.config";

const appGitignorePath = new URL("./.gitignore", import.meta.url).pathname;

export default defineConfig(
	includeIgnoreFile(appGitignorePath),
	...rootConfig,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
		},
		rules: {
			"no-undef": "off",
		},
	},
	{
		files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: [".svelte"],
				parser: ts.parser,
				svelteFeatures: {
					experimentalGenerics: false,
				},
				svelteConfig,
			},
		},
	},
);
