import { PassThrough, Readable } from "stream";
import {
    IAgentRuntime,
    ISpeechService,
    ServiceType,
} from "@algo3b/aikhwarizmi/src/utils/types.ts";
import { Service } from "@algo3b/aikhwarizmi/src/utils/types.ts";
import * as https from 'https';



async function playHTTextToSpeech(runtime: IAgentRuntime,text: string): Promise<Readable> {
    console.log("PlayHT TTS:", text);
    
    const options = {
        method: 'POST',
        hostname: 'api.play.ht',
        path: '/api/v2/tts/stream',
        headers: {
            'accept': 'audio/mpeg',
            'content-type': 'application/json',
            'AUTHORIZATION': process.env.PLAYHT_API_KEY,  // Use environment variables instead of hardcoded values
            'X-USER-ID': process.env.PLAYHT_USER_ID
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            if (res.statusCode !== 200) {
                // Read error response body for better error handling
                let errorData = '';
                res.on('data', chunk => errorData += chunk);
                res.on('end', () => {
                    reject(new Error(`PlayHT API request failed with status ${res.statusCode}: ${errorData}`));
                });
                return;
            }

            const passThrough = new PassThrough();
            
            // Add data event logging to debug stream content
            let dataReceived = false;
            res.on('data', (chunk) => {
                dataReceived = true;
                console.log(`Received chunk of size: ${chunk.length} bytes`);
            });

            res.pipe(passThrough);

            res.on('end', () => {
                if (!dataReceived) {
                    reject(new Error('No audio data received from PlayHT API'));
                }
                console.log('Stream ended');
            });

            res.on('error', (error) => {
                passThrough.destroy(error);
                reject(error);
            });

            resolve(passThrough);
        });

        req.on('error', (error) => {
            reject(error);
        });

        const requestBody = {
            text: text,
            
            voice: 's3://voice-cloning-zero-shot/952aed5d-9b38-4a58-a867-08c448af36b5/original/manifest.json',
            output_format: 'mp3',
            voice_engine: 'PlayDialog',
            quality: 'premium'  // Added quality parameter
        };

        req.write(JSON.stringify(requestBody));
        req.end();
    });
}



export class SpeechService extends Service implements ISpeechService {
    static serviceType: ServiceType = ServiceType.SPEECH_GENERATION;
    
    async generate(runtime: IAgentRuntime, text: string): Promise<Readable> {
        let audioStream: Readable;
        
        try {
            // Try PlayHT first if credentials are available
              return   await playHTTextToSpeech( runtime,text);
           
        } catch (error) {
            console.error('Error in speech generation:', error);
            throw error;
        }
    }
}

