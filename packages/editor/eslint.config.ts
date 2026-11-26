import { defineConfig, includeIgnoreFile } from "eslint/config";
import globals from "globals";
import ts from "typescript-eslint";

import rootConfig from "../../eslint.config";
// eslint-disable-next-line @nx/enforce-module-boundaries -- the rule reads core's source, not its built package ($core resolves to dist, which may be stale)
import { COMMANDS } from "../core/src/graph/commands";
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
			"no-restricted-syntax": [
				"error",
				{
					selector: `CallExpression[callee.type="MemberExpression"][callee.object.name!="view"][callee.property.name=/^(${COMMANDS.join("|")})$/]`,
					// GraphView's navigation wrappers activate the area, then edit through apply().
					message: "Edit the model through apply()",
				},
			],
		},
	},
	{
		files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				svelteFeatures: {
					experimentalGenerics: false,
				},
				svelteConfig,
			},
		},
	},
);
