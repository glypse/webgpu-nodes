import js from "@eslint/js";
import nx from "@nx/eslint-plugin";
import svelte from "eslint-plugin-svelte";
import { includeIgnoreFile, defineConfig } from "eslint/config";
import path from "node:path";
import ts from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...nx.configs["flat/base"],
	...ts.configs.strictTypeChecked,
	...ts.configs.stylisticTypeChecked,

	...svelte.configs.recommended,
	...svelte.configs.prettier,
	{
		files: [
			"**/*.ts",
			"**/*.tsx",
			"**/*.cts",
			"**/*.mts",
			"**/*.js",
			"**/*.jsx",
			"**/*.cjs",
			"**/*.mjs",
			"**/*.svelte",
			"**/*.svelte.ts",
			"**/*.svelte.js"
		],
		languageOptions: {
			parserOptions: {
				projectService: true
			}
		},
		rules: {
			"@nx/enforce-module-boundaries": [
				"error",
				{
					enforceBuildableLibDependency: true,
					allow: [
						// Allow importing eslint config files, with or without file extension
						"^.*/eslint(\\.base)?\\.config(\\.[cm]?[jt]s)?$"
					],
					depConstraints: [
						{
							sourceTag: "*",
							onlyDependOnLibsWithTags: ["*"]
						}
					]
				}
			],
			"@typescript-eslint/consistent-type-definitions": ["error", "type"]
		}
	}
);
