import { PostgresDatabaseAdapter } from "@algo3b/adapter-postgres/src/index.ts";
import { SqliteDatabaseAdapter } from "@algo3b/adapter-sqlite/src/index.ts";
import { DirectClientInterface } from "@algo3b/client-direct/src/index.ts";
import { BorpClientInterface } from "@algo3b/client-borp/src/index.ts";
import { nodePlugin } from "@algo3b/plugin-node/src/index.ts";

import { 
    defaultCharacter,
    AgentRuntime,
    settings,
    Character,
    IAgentRuntime,
    IDatabaseAdapter,
    ModelProviderName,
} from "@algo3b/aikhwarizmi/dist/index.js";
// import { nodePlugin } from "@algo3b/plugin-node/src/index.ts"; // Disabled for Railway deployment
//import { webSearchPlugin } from "@algo3b/plugin-web-search/src/index.ts";
import Database from "better-sqlite3";
import fs from "fs";

import yargs from "yargs";

export const wait = (minTime: number = 1000, maxTime: number = 3000) => {
    const waitTime =
        Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
};

export function parseArguments(): {
    character?: string;
    characters?: string;
} {
    try {
        return yargs(process.argv.slice(2))
            .option("character", {
                type: "string",
                description: "Path to the character JSON file",
            })
            .option("characters", {
                type: "string",
                description:
                    "Comma separated list of paths to character JSON files",
            })
            .parseSync();
    } catch (error) {
        console.error("Error parsing arguments:", error);
        return {};
    }
}

export async function loadCharacters(
    charactersArg: string
): Promise<Character[]> {
    console.log("Loading characters", charactersArg);
    let characterPaths = charactersArg
        ?.split(",")
        .map((path) => path.trim())
        .map((path) => {
            if (path.startsWith("../characters")) {
                return `../${path}`;
            }
            if (path.startsWith("characters")) {
                return `../../${path}`;
            }
            if (path.startsWith("./characters")) {
                return `../.${path}`;
            }
            return path;
        });

    const loadedCharacters = [];

    if (characterPaths?.length > 0) {
        for (const path of characterPaths) {
            try {
                const character = JSON.parse(fs.readFileSync(path, "utf8"));

                // is there a "plugins" field?
                if (character.plugins) {
                    console.log("Plugins are: ", character.plugins);

                    const importedPlugins = await Promise.all(
                        character.plugins.map(async (plugin) => {
                            // if the plugin name doesnt start with @aiKhwarizmi,

                            const importedPlugin = await import(plugin);
                            return importedPlugin;
                        })
                    );

                    character.plugins = importedPlugins;
                }

                loadedCharacters.push(character);
            } catch (e) {
                console.error(`Error loading character from ${path}: ${e}`);
            }
        }
    }

    if (loadedCharacters.length === 0) {
        console.log("No characters found, using default character");
        loadedCharacters.push(defaultCharacter);
    }

    return loadedCharacters;
}

export function getTokenForProvider(
    provider: ModelProviderName,
    character: Character
) {
    switch (provider) {
        case ModelProviderName.OPENAI:
            return (
                character.settings?.secrets?.OPENAI_API_KEY ||
                process.env.OPENAI_API_KEY ||
                settings.OPENAI_API_KEY
            );
        case ModelProviderName.LLAMACLOUD:
            return (
                character.settings?.secrets?.LLAMACLOUD_API_KEY ||
                settings.LLAMACLOUD_API_KEY ||
                character.settings?.secrets?.TOGETHER_API_KEY ||
                settings.TOGETHER_API_KEY ||
                character.settings?.secrets?.XAI_API_KEY ||
                settings.XAI_API_KEY ||
                character.settings?.secrets?.OPENAI_API_KEY ||
                settings.OPENAI_API_KEY
            );
        case ModelProviderName.ANTHROPIC:
            return (
                character.settings?.secrets?.ANTHROPIC_API_KEY ||
                character.settings?.secrets?.CLAUDE_API_KEY ||
                settings.ANTHROPIC_API_KEY ||
                settings.CLAUDE_API_KEY
            );
        case ModelProviderName.REDPILL:
            return (
                character.settings?.secrets?.REDPILL_API_KEY ||
                settings.REDPILL_API_KEY
            );
        case ModelProviderName.OPENROUTER:
            return (
                character.settings?.secrets?.OPENROUTER ||
                settings.OPENROUTER_API_KEY
            );
        // case ModelProviderName.OASIS:
        //     return (
        //         character.settings?.secrets?.OASIS ||
        //         settings.OASIS_API_KEY
        //     );
    }
}

export async function createDirectRuntime(
    character: Character,
    db: IDatabaseAdapter,
    token: string
) {
    console.log("Creating runtime for character", character.name);
    return new AgentRuntime({
        databaseAdapter: db,
        token,
        modelProvider: character.modelProvider,
        evaluators: [],
        character,
        plugins: [],
        providers: [],
        actions: [],
        services: [],
        managers: [],
    });
}

function initializeDatabase() {
    // Check for PostgreSQL connection (supports both Supabase and Vercel Postgres)
    const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    
    console.log('Environment check:', {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL_EXISTS: !!process.env.DATABASE_URL,
        POSTGRES_URL_EXISTS: !!process.env.POSTGRES_URL,
        OPENAI_API_KEY_EXISTS: !!process.env.OPENAI_API_KEY,
        ALL_ENV_KEYS: Object.keys(process.env).filter(key => 
            key.includes('DATABASE') || 
            key.includes('POSTGRES') || 
            key.includes('OPENAI')
        )
    });
    
    if (databaseUrl) {
        console.log('🐘 Using PostgreSQL database');
        
        return new PostgresDatabaseAdapter({
            connectionString: databaseUrl,
            ssl: process.env.NODE_ENV === 'production' ? {
                rejectUnauthorized: false
            } : false
        });
    } else {
        console.log('🗃️ Using SQLite database (development)');
        return new SqliteDatabaseAdapter(new Database("./db.sqlite"));
    }
}

export async function initializeClients(
    character: Character,
    runtime: IAgentRuntime
) {
    const clients = [];
    const clientTypes =
        character.clients?.map((str) => str.toLowerCase()) || [];

  

  

    if (clientTypes.includes("borp")) {
        console.log("Starting borp client");
        const borpClient = await BorpClientInterface.start(runtime);
        // if (borpClient) clients.push(borpClient);
    }

    return clients;
}

export async function createAgent(
    character: Character,
    db: any,
    token: string
) {
    console.log("Creating runtime for character", character.name);
    return new AgentRuntime({
        databaseAdapter: db,
        token,
        modelProvider: character.modelProvider,
        evaluators: [],
        character,
        plugins: [
             nodePlugin, // Disabled for Railway deployment
            //webSearchPlugin,
        
                null
        ].filter(Boolean),
        providers: [],
        actions: [],
        services: [],
        managers: [],
    });
}

async function startAgent(character: Character, directClient: any) {
    try {
        // Debug Railway environment
        console.log("Railway environment check:");
        console.log("RAILWAY_ENVIRONMENT:", process.env.RAILWAY_ENVIRONMENT);
        console.log("Total env vars count:", Object.keys(process.env).length);
        console.log("All env var names:", Object.keys(process.env).sort());
        
        const token = getTokenForProvider(character.modelProvider, character);
        console.log("Token retrieval:", {
            provider: character.modelProvider,
            token_exists: !!token,
            token_length: token?.length || 0
        });
        const db = await initializeDatabase();

        const runtime = await createAgent(character, db, token);

        const clients = await initializeClients(
            character,
            runtime as IAgentRuntime
        );

        directClient.registerAgent(await runtime);

        return clients;
    } catch (error) {
        console.error(
            `Error starting agent for character ${character.name}:`,
            error
        );
        throw error; // Re-throw after logging
    }
}

const startAgents = async () => {
    const directClient = await DirectClientInterface.start();
    const args = parseArguments();

    let charactersArg = args.characters || args.character;

    let characters = [defaultCharacter];

    if (charactersArg) {
        characters = await loadCharacters(charactersArg);
    }

    try {
        for (const character of characters) {
            await startAgent(character, directClient);
        }
    } catch (error) {
        console.error("Error starting agents:", error);
    }

   

    console.log("Agent started. Type 'exit' to quit.");
};

startAgents().catch((error) => {
    console.error("Unhandled error in startAgents:", error);
    process.exit(1); // Exit the process after logging
});




