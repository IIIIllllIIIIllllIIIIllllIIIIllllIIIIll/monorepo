import json from "rollup-plugin-json";

export default {
	input: "dist/src/client/client-interface.js",
	output: {
		file: "build/js/client-interface.min.js",
		format: "iife",
		sourcemap: true,
		name: "ci"
	},
	plugins: [
		json({
			include: [
				"dist/contracts/build/contracts/*",
				"dist/contracts/networks/*"
			],
			preferConst: true
		})
	]
};
