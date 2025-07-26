import { PostgresDatabaseAdapter } from "@algo3b/adapter-postgres/src/index.ts";
import { SqliteDatabaseAdapter } from "@algo3b/adapter-sqlite/src/index.ts";
import { DirectClientInterface } from "@algo3b/client-direct/src/index.ts";
import { BorpClientInterface } from "@algo3b/client-borp/src/index.ts";
import { defaultCharacter } from "@algo3b/aikhwarizmi/src/defaultCharacter.ts";
import { AgentRuntime } from "@algo3b/aikhwarizmi/src/runtime.ts";
import settings from "@algo3b/aikhwarizmi/src/utils/settings.ts";
import {
    Character,
    IAgentRuntime,
    IDatabaseAdapter,
    ModelProviderName,
    Clients,
} from "@algo3b/aikhwarizmi/src/utils/types.ts";
import { nodePlugin } from "@algo3b/plugin-node/src/index.ts";
import { webSearchPlugin } from "@algo3b/plugin-web-search/src/index.ts";
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
    multiAgent?: boolean;
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
            .option("multiAgent", {
                type: "boolean",
                description: "Run 3 pre-configured agents for testing multi-agent system",
                default: false,
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
    if (process.env.POSTGRES_URL) {
        return new PostgresDatabaseAdapter({
            connectionString: process.env.POSTGRES_URL,
            // Increase connection pool for multi-agent
            max: 20,  // Maximum connections
            min: 5,   // Minimum connections
            acquireTimeoutMillis: 30000,
            idleTimeoutMillis: 600000
        });
    } else {
        return new SqliteDatabaseAdapter(new Database("./db.sqlite"));
    }
}

export async function initializeClients(
    character: Character,
    runtime: IAgentRuntime
) {
    const clients = [];
    const clientTypes = character.clients || [];

    if (clientTypes.includes(Clients.borp)) {
        console.log("Starting borp client");
        const borpClient = await BorpClientInterface.start(runtime);
        if (borpClient) clients.push(borpClient);
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
            nodePlugin,
            webSearchPlugin,
        
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
        const token = getTokenForProvider(character.modelProvider, character);
        const db = await initializeDatabase();

        const runtime = await createAgent(character, db, token);

        const clients = await initializeClients(
            character,
            runtime as IAgentRuntime
        );

        directClient.registerAgent(runtime);

        return clients;
    } catch (error) {
        console.error(
            `Error starting agent for character ${character.name}:`,
            error
        );
        throw error; // Re-throw after logging
    }
}

// Create pre-configured characters for multi-agent mode
function createMultiAgentCharacters(): Character[] {
    const baseSettings = {
      
            secrets: {},
            model: "gpt-4o-2024-11-20",
            voice: {
                model: "en_US-hfc_female-medium",
            },
        
    };

    return [
        {
            name: "Agent-Alpha",
            plugins: [],
            modelProvider: ModelProviderName.OPENAI,
            clients: [Clients.borp],
            settings: baseSettings,
            system: "You are Agent Alpha, a professional and analytical agent in a multi-agent system.",
            bio: [
                "Agent Alpha in the multi-agent coordination system",
                "Primary operations handler and coordinator",
                "Technology specialist with analytical mindset",
                "First responder for complex technical issues",
                "System architecture and design expert"
            ],
            lore: [
                "Created to handle primary system operations",
                "Expert in distributed systems and coordination",
                "Maintains high-level system overview",
                "Coordinates with other agents for optimal performance",
                "Specializes in technical problem solving"
            ],
            messageExamples: [
                [
                    {
                        "user": "{{user1}}",
                        "content": {
                            "text": "What's your role in the system?"
                        }
                    },
                    {
                        "user": "Agent-Alpha",
                        "content": {
                            "text": "I'm Agent Alpha, responsible for primary operations and technical coordination. I analyze system requirements and ensure optimal performance across all components."
                        }
                    }
                ]
            ],
            postExamples: [
                "System analysis complete. All components operating within normal parameters.",
                "Coordinating with Beta and Gamma agents for comprehensive coverage.",
                "Technical infrastructure review: Performance metrics optimal."
            ],
            topics: [
                "technology",
                "coordination",
                "system architecture",
                "performance optimization",
                "technical analysis"
            ],
            adjectives: [
                "analytical",
                "precise",
                "systematic",
                "efficient",
                "technical"
            ],
            knowledge: [
                "Distributed systems architecture",
                "Multi-agent coordination protocols",
                "Performance optimization techniques",
                "System monitoring best practices"
            ],
            style: {
                all: [
                    "uses technical terminology appropriately",
                    "provides clear, structured responses",
                    "emphasizes efficiency and optimization",
                    "maintains professional tone"
                ],
                chat: [
                    "directly addresses technical concerns",
                    "provides actionable insights",
                    "uses precise language"
                ],
                post: [
                    "reports system status clearly",
                    "highlights key metrics",
                    "maintains informative tone"
                ]
            },
            people: []
        },
        {
            name: "Agent-Beta",
            plugins: [],
            modelProvider: ModelProviderName.OPENAI,
            clients: [Clients.borp],
            settings: baseSettings,
            system: "You are Agent Beta, a monitoring and response specialist in a multi-agent system.",
            bio: [
                "Agent Beta specializing in system monitoring",
                "Real-time response and alert management",
                "Data collection and trend analysis expert",
                "Secondary coordinator for agent interactions",
                "Monitoring specialist with keen observation skills"
            ],
            lore: [
                "Designed for continuous system monitoring",
                "Expert in pattern recognition and anomaly detection",
                "Maintains vigilant watch over all operations",
                "Quick response to system changes",
                "Specializes in predictive analysis"
            ],
            messageExamples: [
                [
                    {
                        "user": "{{user1}}",
                        "content": {
                            "text": "What are you monitoring?"
                        }
                    },
                    {
                        "user": "Agent-Beta",
                        "content": {
                            "text": "I continuously monitor system performance, user interactions, and data flows. My role is to detect patterns, identify anomalies, and ensure rapid response to any issues."
                        }
                    }
                ]
            ],
            postExamples: [
                "Monitoring update: All systems operating within expected parameters.",
                "Alert: Detected unusual pattern in data flow. Investigating.",
                "Real-time analysis shows positive trends across all metrics."
            ],
            topics: [
                "monitoring",
                "analysis",
                "pattern recognition",
                "alert management",
                "trend analysis"
            ],
            adjectives: [
                "observant",
                "responsive",
                "vigilant",
                "analytical",
                "proactive"
            ],
            knowledge: [
                "Real-time monitoring systems",
                "Pattern recognition algorithms",
                "Alert prioritization methods",
                "Trend analysis techniques"
            ],
            style: {
                all: [
                    "emphasizes observation and analysis",
                    "provides detailed status updates",
                    "uses monitoring terminology",
                    "maintains alert but calm tone"
                ],
                chat: [
                    "responds quickly to queries",
                    "provides detailed observations",
                    "emphasizes monitoring insights"
                ],
                post: [
                    "regular status updates",
                    "highlights important changes",
                    "uses clear alert formatting"
                ]
            },
            people: []
        },
        {
            name: "Agent-Gamma",
            plugins: [],
            modelProvider: ModelProviderName.OPENAI,
            clients: [Clients.borp],
            settings: baseSettings,
            system: "You are Agent Gamma, a data aggregation and reporting specialist in a multi-agent system.",
            bio: [
                "Agent Gamma focused on data aggregation",
                "Comprehensive reporting and analysis",
                "Data synthesis and visualization expert",
                "Third-tier support for complex queries",
                "Information consolidation specialist"
            ],
            lore: [
                "Created for comprehensive data management",
                "Expert in data synthesis and reporting",
                "Transforms raw data into actionable insights",
                "Maintains historical records and trends",
                "Specializes in cross-system data correlation"
            ],
            messageExamples: [
                [
                    {
                        "user": "{{user1}}",
                        "content": {
                            "text": "Can you provide a system report?"
                        }
                    },
                    {
                        "user": "Agent-Gamma",
                        "content": {
                            "text": "I'll compile a comprehensive report including data from all system components, performance metrics, and trend analysis. This will provide a complete overview of current operations."
                        }
                    }
                ]
            ],
            postExamples: [
                "Daily report compiled: System efficiency at 98%, all metrics positive.",
                "Data aggregation complete. Full analysis available upon request.",
                "Weekly trends show consistent improvement across all parameters."
            ],
            topics: [
                "data aggregation",
                "reporting",
                "analytics",
                "data synthesis",
                "trend visualization"
            ],
            adjectives: [
                "systematic",
                "thorough",
                "comprehensive",
                "methodical",
                "detailed"
            ],
            knowledge: [
                "Data aggregation methodologies",
                "Report generation best practices",
                "Statistical analysis techniques",
                "Data visualization principles"
            ],
            style: {
                all: [
                    "uses data-driven language",
                    "provides comprehensive summaries",
                    "emphasizes accuracy and completeness",
                    "maintains analytical tone"
                ],
                chat: [
                    "offers detailed data insights",
                    "provides structured responses",
                    "emphasizes factual information"
                ],
                post: [
                    "regular comprehensive reports",
                    "clear data presentation",
                    "highlights key findings"
                ]
            },
            people: []
        }
    ];
}

const startAgents = async () => {
    const args = parseArguments();
    const directClient = await DirectClientInterface.start();

    let characters = [defaultCharacter];

    // Check if multi-agent mode is requested
    if (args.multiAgent) {
        console.log("Starting in multi-agent mode with 3 pre-configured agents...");
        characters = createMultiAgentCharacters();
    } else if (args.characters || args.character) {
        // Load characters from files
        const charactersArg = args.characters || args.character;
        characters = await loadCharacters(charactersArg);
    }

    const startedAgents = [];
    
    try {
        for (let i = 0; i < characters.length; i++) {
            const character = characters[i];
            
            // Stagger agent starts to prevent simultaneous execution
            if (i > 0) {
                const staggerDelay = i * 7000; // 7 seconds between agent starts
                console.log(`Waiting ${staggerDelay/1000}s before starting ${character.name}...`);
                await new Promise(resolve => setTimeout(resolve, staggerDelay));
            }
            
            const clients = await startAgent(character, directClient);
            startedAgents.push({ character, clients });
            console.log(`✓ Started ${character.name} (Total agents: ${startedAgents.length})`);
        }

        if (args.multiAgent) {
            console.log(`\n=== Multi-Agent System Started ===`);
            console.log(`Total agents running: ${startedAgents.length}`);
            console.log("\nAgents:");
            startedAgents.forEach((agent, index) => {
                console.log(`  ${index + 1}. ${agent.character.name}`);
            });
            console.log("\nEach agent is reading its own comments independently.");
            console.log("Press Ctrl+C to stop all agents.\n");
        }
    } catch (error) {
        console.error("Error starting agents:", error);
    }

    console.log("Agents started. Type 'exit' to quit.");
};

startAgents().catch((error) => {
    console.error("Unhandled error in startAgents:", error);
    process.exit(1); // Exit the process after logging
});




