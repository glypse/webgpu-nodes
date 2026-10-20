import { defineConfig, includeIgnoreFile } from "eslint/config";
import globals from "globals";

import rootConfig from "../../eslint.config";

const gitignorePath = new URL("./.gitignore", import.meta.url).pathname;

export default defineConfig(includeIgnoreFile(gitignorePath), ...rootConfig, {
	languageOptions: {
		globals: { ...globals.node },
	},
	rules: {
		"no-undef": "off",
	},
});
