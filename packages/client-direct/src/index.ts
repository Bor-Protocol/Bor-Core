import bodyParser from "body-parser";
import cors from "cors";
import express, { Request as ExpressRequest } from "express";

import { messageCompletionFooter } from "@algo3b/aikhwarizmi/src/utils/parsing.ts";
import { AgentRuntime } from "@algo3b/aikhwarizmi/src/runtime.ts";
import {
    Client,
    IAgentRuntime,
} from "@algo3b/aikhwarizmi/src/utils/types.ts";
import settings from "@algo3b/aikhwarizmi/src/utils/settings.ts";
import { createAuthRoutes } from "./authRoutes.ts";

export const messageHandlerTemplate =
    // {{goals}}
    `# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

{{actions}}

# Instructions: Write the next message for {{agentName}}. Ignore "action".
` + messageCompletionFooter;

export interface SimliClientConfig {
    apiKey: string;
    faceID: string;
    handleSilence: boolean;
    videoRef: any;
    audioRef: any;
}
export class DirectClient {
    private app: express.Application;
    private agents: Map<string, AgentRuntime>;
    private databaseAdapter: any;

    constructor(databaseAdapter?: any) {
        console.log("DirectClient constructor");
        this.app = express();
        this.app.use(cors());
        this.agents = new Map();
        this.databaseAdapter = databaseAdapter;

        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));

        // Setup authentication routes if database adapter is provided
        if (this.databaseAdapter) {
            this.setupAuthRoutes();
        }
    }

    private setupAuthRoutes() {
        // Add authentication routes
        this.app.use('/api/auth', createAuthRoutes(this.databaseAdapter));
        
        // Health check endpoint
        this.app.get('/api/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                timestamp: new Date().toISOString(),
                agents: this.agents.size 
            });
        });

        // API info endpoint
        this.app.get('/api', (req, res) => {
            res.json({
                name: 'BOR Protocol API',
                version: '1.0.0',
                endpoints: {
                    auth: {
                        signup: 'POST /api/auth/signup',
                        login: 'POST /api/auth/login',
                        refresh: 'POST /api/auth/refresh',
                        me: 'GET /api/auth/me'
                    },
                    users: {
                        spendPoints: 'POST /api/users/spend-points'
                    },
                    system: {
                        health: 'GET /api/health'
                    }
                }
            });
        });

        console.log("Authentication routes setup complete");
    }

    public registerAgent(runtime: AgentRuntime) {
        this.agents.set(runtime.agentId, runtime);
    }

    public unregisterAgent(runtime: AgentRuntime) {
        this.agents.delete(runtime.agentId);
    }

    public start(port: number) {
        this.app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}/`);
        });
    }
}

export const DirectClientInterface: Client = {
    start: async (runtime: IAgentRuntime) => {
        console.log("DirectClientInterface start");
        // Pass the database adapter from runtime to enable authentication
        const client = new DirectClient(runtime?.databaseAdapter);
        const serverPort = parseInt(settings.SERVER_PORT || "3000");
        client.start(serverPort);
        return client;
    },
    stop: async (runtime: IAgentRuntime) => {
        console.warn("Direct client does not support stopping yet");
    },
};

export default DirectClientInterface;
