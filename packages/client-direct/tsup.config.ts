import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    format: ["esm"], // Ensure you're targeting CommonJS
    dts: true, // Generate declaration files
    splitting: true, // Enable code splitting
    treeshake: true, // Enable tree shaking
    external: [
        "dotenv", // Externalize dotenv to prevent bundling
        "fs", // Externalize fs to use Node.js built-in module
        "path", // Externalize other built-ins if necessary
        "@reflink/reflink",
        "@node-llama-cpp",
        "https",
        "http",
        "agentkeepalive"
        // Add other modules you want to externalize
    ],
    esbuildOptions(options) {
        options.resolveExtensions = ['.ts', '.tsx', '.js', '.jsx']
    }
});
