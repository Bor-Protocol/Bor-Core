import { Plugin } from "@algo3b/aikhwarizmi/src/utils/types.ts";

import { SpeechService } from "./services/speech.ts";

export const nodePlugin: Plugin = {
    name: "default",
    description: "Default plugin, with basic actions and evaluators",
    services: [
        SpeechService,
    ],
};

export default nodePlugin;
