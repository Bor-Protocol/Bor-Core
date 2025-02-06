import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export class ConfigReader {
    private static instance: ConfigReader;
    private configPath: string;
    private config: Map<string, string>;

    private constructor() {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        this.configPath = path.join(__dirname, '../config.properties');
        this.config = new Map();
        this.loadConfig();
    }

    public static getInstance(): ConfigReader {
        if (!ConfigReader.instance) {
            ConfigReader.instance = new ConfigReader();
        }
        return ConfigReader.instance;
    }

    private loadConfig() {
        try {
            const content = fs.readFileSync(this.configPath, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                // Skip comments and empty lines
                if (line.trim().startsWith('#') || line.trim() === '') {
                    continue;
                }

                const [key, value] = line.split('=').map(part => part.trim());
                if (key && value) {
                    this.config.set(key, value);
                }
            }

            console.log("Configuration loaded successfully", {
                configPath: this.configPath,
                entries: Array.from(this.config.entries())
            });
        } catch (error) {
            console.error("Error loading configuration:", error);
            throw error;
        }
    }

    public getValue(key: string): string {
        return this.config.get(key) || '';
    }

    public reloadConfig() {
        this.config.clear();
        this.loadConfig();
    }
} 