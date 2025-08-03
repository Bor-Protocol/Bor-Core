console.log("=== Environment Variables Test ===");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);
console.log("OPENAI_API_KEY exists:", !!process.env.OPENAI_API_KEY);
console.log("\nAll environment variables:");
Object.keys(process.env).forEach(key => {
    if (key.includes("DATABASE") || key.includes("OPENAI") || key.includes("POSTGRES")) {
        console.log(`${key}: [SET]`);
    }
});
console.log("\nTotal env vars:", Object.keys(process.env).length);