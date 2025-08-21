import { PassThrough, Readable } from "stream";
import {
    IAgentRuntime,
    ISpeechService,
    ServiceType,
} from "@algo3b/aikhwarizmi/src/utils/types.ts";
import { Service } from "@algo3b/aikhwarizmi/src/utils/types.ts";
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

/**
 * ElevenLabs TTS Service
 * 
 * Models: 
 * - 'eleven_monolingual_v1' (best quality for English)
 * - 'eleven_multilingual_v2' (supports multiple languages)
 * - 'eleven_turbo_v2' (faster, lower latency)
 * 
 * Voice settings:
 * - stability (0-1): Lower = more expressive, Higher = more consistent
 * - similarity_boost (0-1): Higher = closer to original voice
 * - style (0-1): Higher = more expressive intonation
 * - use_speaker_boost: Enhances voice clarity
 * 
 * Output formats (by tier):
 * - Free tier: mp3_44100_32, mp3_44100_64, mp3_44100_96, mp3_44100_128
 * - Creator tier+: mp3_44100_192, pcm_16000, pcm_22050, pcm_24000, pcm_44100
 */




export class SpeechService extends Service implements ISpeechService {
    static serviceType: ServiceType = ServiceType.SPEECH_GENERATION;
   
    async generate(runtime: IAgentRuntime, text: string): Promise<Readable> {
        try {
            console.log("Generating speech with ElevenLabs");
            return await elevenLabsTTS(runtime, text);
        } catch (error) {
            console.error("ElevenLabs TTS error:", error);
            throw error;
        }
    }
}


async function elevenLabsTTS(runtime: IAgentRuntime, text: string): Promise<Readable> {
    try {
        const apiKey = runtime.getSetting("ELEVENLABS_XI_API_KEY");
        if (!apiKey) {
            throw new Error("ElevenLabs API key not configured");
        }

        const elevenlabs = new ElevenLabsClient({
            apiKey: apiKey
        });
        
        const voiceId = runtime.getSetting("ELEVENLABS_VOICE_ID") || 'JBFqnCBsd6RMkjVDRZzb';
        const modelId = runtime.getSetting("ELEVENLABS_MODEL_ID") || 'eleven_v3';
        
        console.log("ElevenLabs TTS:", { text: text.substring(0, 50) + "...", voiceId, modelId });
        
        // Using the SDK's convert method which returns audio data
        const audio = await elevenlabs.textToSpeech.convert(voiceId, {
            text: text,
            modelId: modelId, // Fixed: using 'modelId' instead of 'model_id'
            voiceSettings: {
                stability: parseFloat(runtime.getSetting("ELEVENLABS_VOICE_STABILITY") || "0.5"),
                similarityBoost: parseFloat(runtime.getSetting("ELEVENLABS_VOICE_SIMILARITY_BOOST") || "0.75"),
                style: parseFloat(runtime.getSetting("ELEVENLABS_VOICE_STYLE") || "0.0"),
                useSpeakerBoost: runtime.getSetting("ELEVENLABS_VOICE_USE_SPEAKER_BOOST") !== "false"
            },
            outputFormat: "mp3_44100_128" // Standard quality MP3 (works with all tiers)
        });
        
        // Convert the audio response to a readable stream
        const passThrough = new PassThrough();
        
        // The ElevenLabs SDK returns a ReadableStream (web stream)
        // We need to convert it to a Node.js stream
        const reader = audio.getReader();
        
        (async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        passThrough.end();
                        break;
                    }
                    passThrough.write(Buffer.from(value));
                }
            } catch (error) {
                console.error("Error reading audio stream:", error);
                passThrough.destroy(error);
            }
        })();
        
        return passThrough;
    } catch (error) {
        console.error("ElevenLabs TTS error:", error);
        throw error;
    }
}

