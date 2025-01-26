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

    constructor() {
        console.log("DirectClient constructor");
        this.app = express();
        this.app.use(cors());
        this.agents = new Map();

        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));
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
        const client = new DirectClient();
        const serverPort = parseInt(settings.SERVER_PORT || "3000");
        client.start(serverPort);
        return client;
    },
    stop: async (runtime: IAgentRuntime) => {
        console.warn("Direct client does not support stopping yet");
    },
};

export default DirectClientInterface;
