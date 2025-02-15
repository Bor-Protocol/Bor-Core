import { webSearch } from "./actions/webSearch.js";
import type { Plugin } from "@algo3b/aikhwarizmi";
import { WebSearchService } from "./services/webSearchService.js";

export const webSearchPlugin: Plugin = {
    name: "webSearch",
    description: "Search the web and get news",
    actions: [webSearch],
    evaluators: [],
    providers: [],
    services: [new WebSearchService()],
    clients: [],
};

export default webSearchPlugin;
