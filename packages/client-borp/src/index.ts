import {
    Client,
    Content,
    IAgentRuntime,
    Memory,
    ModelClass,
    ServiceType,
    State,
    UUID
} from "@algo3b/aikhwarizmi/src/utils/types.ts";
import { stringToUuid } from "@algo3b/aikhwarizmi/src/utils/uuid.ts";
import { fetchRoomMessages, fetchUnreadComments, IComment, markCommentsAsRead, postRoomMessage } from './db/index.ts';
import { embeddingZeroVector } from "@algo3b/aikhwarizmi";
import { composeContext } from "@algo3b/aikhwarizmi";

import { generateMessageResponse, generateText } from "@algo3b/aikhwarizmi/src/index.ts";
import https from 'https';
import { parseJSONObjectFromText } from "@algo3b/aikhwarizmi/src/utils/parsing.ts";
import {
    borpAnimationTemplate,
    borpMessageAnimationTemplate,
    borpMessageHandlerTemplate,
    borpSelectCommentTemplate,
} from "./templates.ts";
import { Readable } from 'stream';
import axios from 'axios';

import { ANIMATION_OPTIONS, SERVER_ENDPOINTS, SERVER_URL, getAllAnimations } from "./constants.ts";
import { AIResponse, StreamingStatusUpdate, TaskPriority } from "./types.ts";
import { aiKhwarizmiLogger } from '@algo3b/aikhwarizmi';
import { ConfigReader } from './utils/configReader.ts';

const api_key = process.env.BORP_API_KEY;



export class BorpClient {
    private currentSubject: string;
    private mode: string;
    interval: NodeJS.Timeout;

    intervalTopLikers: NodeJS.Timeout;
    intervalTotalLikes: NodeJS.Timeout;
    runtime: IAgentRuntime;

    roomId: UUID;


    private lastProcessedTimestamp: Date | undefined;
    private lastAgentChatMessageId: string | null = null;
    
    // Fallback responses for when AI fails
    private fallbackResponses = [
        "⚠️ Under maintenance! Dev is fixing it - but hey, thanks for the comment!",
        "⚠️ Under maintenance! Dev is fixing it - that's interesting though!",
        "⚠️ Under maintenance! Dev is fixing it - I appreciate you being here!",
        "⚠️ Under maintenance! Dev is fixing it - cool! What do you think about that?",
        "⚠️ Under maintenance! Dev is fixing it - thanks for watching the stream!",
        "⚠️ Under maintenance! Dev is fixing it - that's a good point!",
        "⚠️ Under maintenance! Dev is fixing it - I'm glad you're here with me!",
        "⚠️ Under maintenance! Dev is fixing it - what's your favorite part so far?",
        "⚠️ Under maintenance! Dev is fixing it - you guys are awesome!",
        "⚠️ Under maintenance! Dev is fixing it - keep the comments coming!",
        "⚠️ Under maintenance! Dev is fixing it - that made me smile!",
        "⚠️ Under maintenance! Dev is fixing it - I love interacting with you all!",
        "⚠️ Under maintenance! Dev is fixing it - great question!",
        "⚠️ Under maintenance! Dev is fixing it - you're absolutely right!",
        "⚠️ Under maintenance! Dev is fixing it - I hadn't thought of it that way!"
    ];
    
    // Fallback animations for when animation generation fails
    private fallbackAnimations = [
        "idle",
        "happy",
        "acknowledging",
        "greeting",
        "head_nod_yes",
        "standing_clap"
    ];



    private configReader: ConfigReader;



        private taskQueue: TaskPriority[] = [
 
            {
                name: 'readChatAndReply',
                priority: 1,
                minInterval: 1000 * 1
            }
        ];
    
        private taskInterval: NodeJS.Timeout;
    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
        this.roomId = stringToUuid(`borp-stream-${this.runtime.agentId}`);
        this.lastProcessedTimestamp = new Date();

        console.log("borp: constructor", {
            runtime: this.runtime,
            settings: this.runtime.character.settings,
            vrm: this.runtime.character.settings?.secrets?.vrm,
            avatar: this.runtime.character.settings?.secrets?.avatar,
            lastProcessedTimestamp: this.lastProcessedTimestamp
        });

        // Start the task scheduler
        this.taskInterval = setInterval(() => {
            this.processNextTask();
        }, 1000); // Check for new tasks every second
    }
    // Helper methods for fallbacks
    private getRandomFallbackResponse(): string {
        const randomIndex = Math.floor(Math.random() * this.fallbackResponses.length);
        return this.fallbackResponses[randomIndex];
    }
    
    private getRandomFallbackAnimation(): string {
        const randomIndex = Math.floor(Math.random() * this.fallbackAnimations.length);
        return this.fallbackAnimations[randomIndex];
    }
    
    // Add audio status message to response if needed
    private addAudioStatusMessage(text: string, hasAudio: boolean): string {
        if (!hasAudio) {
            return `🔊 Audio service temporarily unavailable - text reply only: ${text}`;
        }
        return text;
    }
    
    // Generic error handler wrapper
    private async safeExecute<T>(
        operation: () => Promise<T>,
        fallback: T,
        operationName: string
    ): Promise<T> {
        try {
            return await operation();
        } catch (error: any) {
            // Log the error with context
            const errorDetails = {
                operation: operationName,
                errorName: error?.name || 'UnknownError',
                errorMessage: error?.message || error?.toString() || 'Unknown error occurred',
                errorStack: error?.stack,
                timestamp: new Date().toISOString()
            };
            
            aiKhwarizmiLogger.error(`[FALLBACK] ${operationName} failed:`, errorDetails);
            
            // Special handling for speech generation failures
            if (operationName.includes("Speech Generation")) {
                aiKhwarizmiLogger.warn(`🔊 Audio service unavailable - continuing with text-only responses`);
            }
            
            // Return the fallback value
            return fallback;
        }
    }
    
    // Emergency fallback response when everything else fails
    private async createFallbackResponse(comment: IComment) {
        try {
            // Use the properly formatted fallback response (already includes maintenance message)
            const fallbackText = this.getRandomFallbackResponse();
            const fallbackAnimation = this.getRandomFallbackAnimation();
            
            const body: AIResponse = {
                id: stringToUuid(`${this.runtime.agentId}-${Date.now()}-fallback`),
                text: fallbackText,
                agentId: this.runtime.agentId,
                replyToMessageId: comment.id,
                replyToMessage: comment.message,
                replyToUser: comment.user,
                replyToHandle: comment.handle,
                replyToPfp: comment.avatar,
                isGiftResponse: false,
                giftName: null,
                audioUrl: null, // No audio in emergency fallback
                animation: fallbackAnimation,
            };

            // Try to post the fallback response
            try {
                const fetchResponse = await fetch(SERVER_ENDPOINTS.POST.AI_RESPONSES, {
                    method: "POST",
                    headers: {
                        'Content-Type': 'application/json',
                        'api_key': api_key
                    },
                    body: JSON.stringify(body),
                });
                
                aiKhwarizmiLogger.log(`Emergency fallback response posted: ${fallbackText}`);
            } catch (apiError) {
                aiKhwarizmiLogger.error("Even fallback API call failed:", apiError);
            }
            
            // Mark comment as read to prevent retry loops
            try {
                await markCommentsAsRead([comment.id]);
            } catch (markError) {
                aiKhwarizmiLogger.error("Failed to mark comment as read:", markError);
            }
            
        } catch (error) {
            aiKhwarizmiLogger.error("Emergency fallback response creation failed:", error);
        }
    }

    /**
     * Processes the next available task in the task queue based on priority and timing
     * Tasks are executed sequentially to avoid conflicts and maintain system stability
     */
    private async processNextTask() {
        // Get current timestamp to check task eligibility
        const now = Date.now();

        // Find the highest priority task that:
        // 1. Isn't currently running
        // 2. Has waited long enough since its last run (minInterval)
        const eligibleTask = this.taskQueue.find(task => {
            const timeElapsed = now - (task.lastRun || 0);
            return !task.isRunning && timeElapsed >= task.minInterval;
            //return task;
        });

        // Exit if no tasks are eligible to run
        if (!eligibleTask) return;

        // Set task status to running to prevent concurrent execution
        eligibleTask.isRunning = true;

        try {
            // Execute the appropriate task based on task name
            // Each task handles a different aspect of the AI's behavior:
            // - readChatAndReply: Monitor chat and generate responses
            // - generateFreshThought: Create unprompted messages
            // - generatePeriodicAnimation: Update AI's animation state
            // - heartbeat: Maintain connection status
            switch (eligibleTask.name) {
             
                case 'readChatAndReply':
                    await this.safeExecute(
                        async () => await this.readChatAndReply(),
                        null,
                        "Main Chat Reading Task"
                    );
                    break;

            }
        } catch (error) {
            // Log any errors that occur during task execution
            console.error(`Error executing task ${eligibleTask.name}:`, error);
        } finally {
            // Clean up task state regardless of success/failure:
            // - Update the last run timestamp
            // - Reset the running flag to allow future execution
            eligibleTask.lastRun = Date.now();
            eligibleTask.isRunning = false;
        }
    }







 

 

    async heartbeat() {
        await this.updateStreamingStatus({
            isStreaming: true,
        });
    }
    // Chat & Message Processing




    // Add method to check for unread messages
    private async hasUnreadMessages(): Promise<boolean> {
        try {
            const { comments } = await fetchUnreadComments(
                this.runtime.agentId,
                this.lastProcessedTimestamp
            );
            return comments && comments.length > 0;
        } catch (error) {
            aiKhwarizmiLogger.error("Error checking unread messages:", error);
            return false;
        }
    }


    async readChatAndReply() {
        try {
            console.log("abderrahmen 2");
            // Read Comments since last processed timestamp
            aiKhwarizmiLogger.log(`[${new Date().toLocaleString()}] Borp (${this.runtime.character.name}): Reading chat since`,
                this.lastProcessedTimestamp?.toISOString());

            const result = await this.safeExecute(
                async () => await fetchUnreadComments(
                    this.runtime.agentId,
                    this.lastProcessedTimestamp
                ),
                { comments: [] },
                "Fetch Unread Comments"
            );
            
            const comments = result.comments;

            if (comments && comments.length > 0) {
                const processedComments = await this.safeExecute(
                    async () => await this.processComments(comments),
                    [],
                    "Process Comments"
                );
                
                // If processing completely failed, create a fallback response
                if (processedComments.length === 0 && comments.length > 0) {
                    await this.createFallbackResponse(comments[0]);
                }
            }

            // Update the timestamp to current time after processing
            this.lastProcessedTimestamp = new Date();

        } catch (error) {
            aiKhwarizmiLogger.error("Critical error in readChatAndReply:", error);
            // Even in critical error, update timestamp to prevent infinite retry loops
            this.lastProcessedTimestamp = new Date();
        }
    }

    async processComments(comments: IComment[]) {
        aiKhwarizmiLogger.error(`abdos ` + JSON.stringify(comments));

        aiKhwarizmiLogger.log(comments);
        const commentIds = comments?.map(comment => comment.id) ?? [];

        if (commentIds.length === 0) {
            aiKhwarizmiLogger.log(`borp (${this.runtime.character.name}): No comments to process`);
            return commentIds;
        }

        aiKhwarizmiLogger.error(`abdos ` + JSON.stringify(commentIds));

        // Mark all comments as read
       try {
            await markCommentsAsRead(commentIds);
        } catch (error) {
            aiKhwarizmiLogger.error("borp: Failed to mark comments as read", { error });
        }

        // Create memories for all comments
        let memoriesCreated = 0;
        await Promise.allSettled(comments.map(async comment => {
            const memory: Memory = {
                id: stringToUuid(`${comment.id}-${this.runtime.agentId}`),
                ...userMessage,
                userId: userIdUUID,
                agentId: this.runtime.agentId,
                roomId: this.roomId,
                content,
                createdAt: comment.createdAt.getTime(),
                embedding: embeddingZeroVector,
            }
            // Create a memory for this comment
            if (content.text) {
                await this.runtime.messageManager.createMemory(memory);
                memoriesCreated++;
            }
        }));

        // If there's only one comment, select it automatically
        let selectedCommentId;
        if (comments.length === 1) {
            selectedCommentId = comments[0].id;
        } else {
            // Otherwise, use the selection logic for multiple comments
            selectedCommentId = await this.selectCommentToRespondTo(comments);
        }

        if (!selectedCommentId) {
            aiKhwarizmiLogger.log("No suitable comment found to respond to");
            return comments;
        }

        // Find the selected comment
        const selectedComment = comments.find(comment => comment.id === selectedCommentId);
        if (!selectedComment) {
            aiKhwarizmiLogger.error("Selected comment not found:", selectedCommentId);
            return comments;
        }

        const userIdUUID = stringToUuid(selectedComment.handle);

        // Add this new section to create first interaction memory
        try {
            aiKhwarizmiLogger.log("Fetching existing memories with params:", {
                roomId: this.roomId,
                agentId: this.runtime.agentId,
                userId: userIdUUID,
                userIdStr: userIdUUID.toString() // Log string representation
            });

            const existingMemories = await this.runtime.messageManager.getMemories({
                roomId: this.roomId,
                agentId: this.runtime.agentId,
                userId: userIdUUID
            });

            aiKhwarizmiLogger.log("Existing memories result:", {
                found: !!existingMemories,
                count: existingMemories?.length,
                firstMemory: existingMemories?.[0]
            });

            if (selectedComment.message !== undefined && (existingMemories === undefined || existingMemories.length === 0)) {
                // This is the first interaction - create a special memory
                const firstInteractionMemory: Memory = {
                    id: stringToUuid(`first-interaction-${selectedComment.handle}-${this.runtime.agentId}`),
                    userId: userIdUUID,
                    agentId: this.runtime.agentId,
                    roomId: this.roomId,
                    unique: true,
                    content: {
                        text: `My name is ${selectedComment.handle}`,
                        source: "borp",
                        metadata: {
                            isFirstInteraction: true,
                            username: selectedComment.handle,
                            handle: selectedComment.handle,
                            timestamp: new Date().toISOString()
                        }
                    },
                    createdAt: Date.now(),
                    embedding: embeddingZeroVector,
                };

                try {
                    await this.runtime.messageManager.createMemory(firstInteractionMemory);
                    aiKhwarizmiLogger.log("Successfully created first interaction memory:", {
                        handle: selectedComment.handle,
                        memoryId: firstInteractionMemory.id
                    });
                } catch (createError) {
                    aiKhwarizmiLogger.error("Error creating first interaction memory:", {
                        error: createError,
                        memory: firstInteractionMemory
                    });
                }
            }
        } catch (error) {
            aiKhwarizmiLogger.error("Error checking/creating first interaction memory:", {
                error,
                userIdUUID,
                roomId: this.roomId,
                agentId: this.runtime.agentId
            });
        }

        // Process only the selected comment for response
        const content: Content = {
            text: selectedComment.message,
            source: "borp",
        };

        await this.runtime.ensureConnection(
            userIdUUID,
            this.roomId,
            selectedComment.handle,
            selectedComment.handle,
            "borp"
        );

        const userMessage = {
            content,
            userId: userIdUUID,
            agentId: this.runtime.agentId,
            roomId: this.roomId,
        };

        aiKhwarizmiLogger.log(`borp (${this.runtime.character.name}): selectedComment`, { selectedComment });

        // Get created date
        const createdAt = typeof selectedComment.createdAt === 'string' ?
            new Date(selectedComment.createdAt).getTime() :
            0;

        // Create memory for the selected comment
        const memory: Memory = {
            id: stringToUuid(`${selectedComment.id}-${this.runtime.agentId}`),
            ...userMessage,
            userId: userIdUUID,
            agentId: this.runtime.agentId,
            roomId: this.roomId,
            content,
            createdAt,
            embedding: embeddingZeroVector,
        }

        if (content.text) {
            await this.runtime.messageManager.createMemory(memory);
           // aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: memory created`, { memory });
        }

              // Function to get random elements from an array
              function getRandomElements(arr: string[], count: number): string[] {
                const shuffled = arr.sort(() => 0.5 - Math.random()); // Shuffle the array
                return shuffled.slice(0, count); // Return the first 'count' elements
            }
    
            // Assuming this.runtime.character.lore is the array you provided
            const loreParts = this.runtime.character.lore; // Get the lore array
            const bioParts = this.runtime.character.bio; // Get the bio array

            // Ensure bioParts is always an array
            const bioPartsArray = Array.isArray(bioParts) ? bioParts : [bioParts];
    
            // Check if there are at least 5 parts to select for lore
            const numberOfLorePartsToSelect = Math.min(5, loreParts.length); // Ensure we don't exceed the array length
            const randomLoreParts = getRandomElements(loreParts, numberOfLorePartsToSelect); // Get random lore parts
    
            // Check if there are at least 5 parts to select for bio
            const numberOfBioPartsToSelect = Math.min(5, bioPartsArray.length); // Ensure we don't exceed the array length
            const randomBioParts = getRandomElements(bioPartsArray, numberOfBioPartsToSelect); // Get random bio parts
        

        // Compose state and check if should respond
        const state = (await this.runtime.composeState(userMessage, {
            agentName: this.runtime.character.name,
            selectedComment,
            bio: randomBioParts.join(', '), 
            lore: randomLoreParts.join(', '), // Join the random parts into a string
            adjectives: this.runtime.character.adjectives,
            animationOptions: getAllAnimations().join(", "),
        })) as State;


        // if there is a selected comment, should respond is true
        let shouldRespond = true;
        if (!selectedComment) {
            shouldRespond = false;
        }

        aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: shouldRespond`, { shouldRespond, selectedCommentId });

        if (shouldRespond) {
            let responseContent;
            let animationResponse;
            let speechUrl = null;

        

            // Generate AI response with fallback
            const context = composeContext({
                state,
                template: borpMessageHandlerTemplate,
            });
            aiKhwarizmiLogger.error("/******* this is the context random to be used : "+context + "**********/");


    

            responseContent = await this.safeExecute(
                async () => {
                    const response = await this._generateResponse(memory, state, context);
                    response.text = response.text?.trim();
                    return response;
                },
                {
                    text: this.getRandomFallbackResponse(),
                    source: "borp_fallback"
                },
                "AI Response Generation"
            );

            const responseMessage = {
                ...userMessage,
                userId: this.runtime.agentId,
                content: responseContent,
            };

            await this.runtime.messageManager.createMemory(responseMessage);

            // Generate animation with fallback
            animationResponse = await this.safeExecute(
                async () => {
                    const _borpAnimationTemplate = borpMessageAnimationTemplate({
                        agentName: this.runtime.character.name,
                        lastMessage: responseContent.text,
                        animationOptions: getAllAnimations().join(", "),
                    });

                    return await generateText({
                        runtime: this.runtime,
                        context: _borpAnimationTemplate,
                        modelClass: ModelClass.SMALL,
                    });
                },
                this.getRandomFallbackAnimation(),
                "Animation Generation"
            );

            // Generate speech with fallback
            speechUrl = await this.safeExecute(
                async () => await this.generateSpeech(responseContent.text),
                null,
                "Speech Generation"
            );
            
            // Add audio status message if needed
            const finalText = this.addAudioStatusMessage(responseContent.text, speechUrl !== null);
            
            // Post response
            const body: AIResponse = {
                // Required fields
                id: stringToUuid(`${this.runtime.agentId}-${Date.now()}`),
                text: finalText,
                agentId: this.runtime.agentId,

                // Reply fields
                replyToMessageId: selectedComment.id,
                replyToMessage: selectedComment.message,
                replyToUser: selectedComment.user,
                replyToHandle: selectedComment.handle,
                replyToPfp: selectedComment.avatar,

                isGiftResponse: false,
                giftName: null,
                audioUrl: speechUrl,
                animation: animationResponse,

                // Include any additional fields from responseContent
                ...(responseContent as Omit<typeof responseContent, 'text'>),
            };

            aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: body`, { body });


            // Post response with fallback
            await this.safeExecute(
                async () => {
                    const fetchResponse = await fetch(SERVER_ENDPOINTS.POST.AI_RESPONSES, {
                        method: "POST",
                        headers: {
                            'Content-Type': 'application/json',
                            'api_key': api_key
                        },
                        body: JSON.stringify(body),
                    });

                    if (fetchResponse.status !== 200) {
                        throw new Error(`API responded with status ${fetchResponse.status}`);
                    }
                    
                    aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: CHAT REPLY: Successfully posted response to api`, { responseContent, body });
                    return true;
                },
                false,
                "API Response Posting"
            );
        }

        return commentIds;
    }

    async selectCommentToRespondTo(comments: IComment[]) {
        if (comments.length === 0) {
            return null;
        }

        // Format the recent messages with ID first for easier parsing
        const recentMessages = comments
            .map(comment => `ID: ${comment.id}
                From: ${comment.user}
                Message: ${comment.message}
                ---`)
            .join('\n\n');


        // TODO: This is a bit of a hack to get the state to work
        const memory: Memory = {
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            content: { text: '', source: "borp" },
            roomId: this.roomId,
        }

        const state = await this.runtime.composeState(memory, {
            agentName: this.runtime.character.name,
            recentMessages
        });

        const selectContext = composeContext({
            state,
            template: borpSelectCommentTemplate,
        });

        const selectedCommentId = await this.safeExecute(
            async () => {
                const id = await generateText({
                    runtime: this.runtime,
                    context: selectContext,
                    modelClass: ModelClass.MEDIUM
                });
                
                aiKhwarizmiLogger.log("borp: selectedCommentId", { selectedCommentId: id });
                return id === "NONE" ? null : id;
            },
            comments[0]?.id || null,
            "Comment Selection"
        );
        
        return selectedCommentId;
    }
    private async _generateResponse(
        message: Memory,
        state: State,
        context: string
    ): Promise<Content> {
        const { userId, roomId } = message;

        // Add timeout wrapper to prevent infinite retries
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Response generation timeout after 30 seconds')), 30000);
        });

        try {
            const response = await Promise.race([
                generateMessageResponse({
                    runtime: this.runtime,
                    context,
                    modelClass: ModelClass.MEDIUM,
                }),
                timeoutPromise
            ]);

            if (!response) {
                throw new Error("No response from generateMessageResponse");
            }

            await this.runtime.databaseAdapter.log({
                body: { message, context, response },
                userId: userId,
                roomId,
                type: "response",
            });

            return response;
        } catch (error) {
            // Re-throw to be caught by upper level handler
            throw error;
        }
    }
    async generateSpeech(text: string): Promise<string> {
         aiKhwarizmiLogger.log("borp: generateSpeech", { text });
         const agentName = this.runtime.character.name;
         aiKhwarizmiLogger.log(`borp (${agentName}): starting speech generation for text:`, { text });
     
         // Get speech service and generate audio
         const SpeechService = await this.runtime.getService(ServiceType.SPEECH_GENERATION) as any;
         const speechService = SpeechService.getInstance();
         const audioStream = await speechService.generate(this.runtime, text);
     
         // Convert the audio stream to a buffer
         const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
             const chunks: Uint8Array[] = [];
             audioStream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
             audioStream.on('end', () => resolve(Buffer.concat(chunks)));
             audioStream.on('error', reject);
         });
     
         // Generate filename
         const timestamp = Date.now();
         const fileName = `${this.runtime.agentId}-${timestamp}.mp3`;
     
         try {
             const response = await axios.post(`${SERVER_URL}/api/upload/audio`, audioBuffer, {
                 headers: {
                     'Content-Type': 'audio/mpeg',
                     'Content-Disposition': `attachment; filename="${fileName}"`,
                     'isAudioStream': 'true'
                 },
                 maxBodyLength: Infinity,  // Allow large files
                 maxContentLength: Infinity,
             });
     
             const publicUrl = response.data.url;
             aiKhwarizmiLogger.log(`borp (${agentName}): upload successful`, { publicUrl });
             return publicUrl;
        //return "https://borstorage.b-cdn.net/speech/1737312298831.mp3";
       //return "/audio/ttsMP3.com_VoiceText_2025-7-10_19-15-4.mp3";
        } catch (error) {
         aiKhwarizmiLogger.error(`borp (${agentName}): error sending audio to server`, error);
        throw new Error("Failed to upload audio");
        }
    }








    async updateStreamingStatus(update: Partial<StreamingStatusUpdate>) {
        const sceneConfigs = this.runtime.character.settings?.secrets?.borpSceneConfigs
        const streamSettings = this.runtime.character.settings?.secrets?.borpSettings

        try {
            // Merge default values with provided updates
            const statusUpdate = {
                // Default values
                isStreaming: true,
                lastHeartbeat: new Date(),
                title: `${this.runtime.character.name}'s Stream`,
                description: "Interactive AI Stream",
                type: 'stream',
                component: 'ThreeScene',
                twitter: this.runtime.character.settings?.secrets?.twitterUsername || this.runtime.getSetting("TWITTER_USERNAME"),
                modelName: this.runtime.character.name,
                identifier: this.runtime.character.name.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_'),

                // Include any provided updates
                ...update,

                // Always include agentId
                agentId: this.runtime.agentId,

                // Default creator info if not provided
                creator: streamSettings || update.creator,

                // Default scene configs if not provided
                sceneConfigs: sceneConfigs || [],
                // Default stats if not provided
                stats: update.stats || {
                    likes: 0,
                    comments: 0,
                    bookmarks: 0,
                    shares: 0
                }
            };

            const response = await fetch(`${SERVER_URL}/api/scenes/${this.runtime.agentId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': api_key
                },
                body: JSON.stringify(statusUpdate)
            });

            if (!response.ok) {
                throw new Error(`Failed to update streaming status: ${response.statusText}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to update streaming status');
            }

            aiKhwarizmiLogger.log(`borp (${this.runtime.character.name}): Updated streaming status`, data);
            return data.status; // Server returns { success: true, status: {...} }
        } catch (error) {
            aiKhwarizmiLogger.error(`borp (${this.runtime.character.name}): Failed to update streaming status:`, error);
            throw error;
        }
    }








  










    static ROOM_ID = "borp-room";

    async readAgentChatAndReply() {

        if (!this.runtime.character.settings?.secrets?.isInChat) return;

        const roomId = stringToUuid(BorpClient.ROOM_ID);

        aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: reading chat and replying to agent chat room ${roomId}`);

        try {
            const { success, messages } = await fetchRoomMessages(
                BorpClient.ROOM_ID,
                20
            );

            if (!success || !messages?.length) {
                aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: No messages found or fetch unsuccessful`);
                return;
            }

            const incomingMessages = messages;
            const latestMessage = incomingMessages[incomingMessages.length - 1];

            aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: Message Processing Status:`, {
                totalMessages: incomingMessages.length,
                latestMessage: {
                    id: latestMessage.id,
                    agentId: latestMessage.agentId,
                    agentName: latestMessage.agentName,
                    message: latestMessage.message,
                    timestamp: latestMessage.createdAt
                },
                lastProcessedId: this.lastAgentChatMessageId,
                currentAgentId: this.runtime.agentId,
                isOwnMessage: latestMessage.agentId === this.runtime.agentId,
                isAlreadyProcessed: this.lastAgentChatMessageId === latestMessage.id
            });

            // Check if we've already processed this message
            if (this.lastAgentChatMessageId === latestMessage.id) {
                aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: SKIPPING - Already processed latest message ${latestMessage.id}`);
                return;
            }

            // Check if the latest message is from this agent
            if (latestMessage.agentId === this.runtime.agentId) {
                aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: SKIPPING - Latest message is from self`, {
                    messageId: latestMessage.id,
                    message: latestMessage.message
                });
                this.lastAgentChatMessageId = latestMessage.id;
                return;
            }

            if (incomingMessages.length > 0) {
                // Format chat history for context
                const chatHistory = messages
                    .slice(-10)
                    .map(m => `${m.agentName}: ${m.message}`)
                    .join('\n');

                aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: PROCESSING MESSAGE:`, {
                    chatHistoryLength: messages.slice(-10).length,
                    chatHistory,
                    willRespondTo: {
                        messageId: latestMessage.id,
                        from: latestMessage.agentName,
                        message: latestMessage.message
                    }
                });


                const messageFooter = `\nResponse format should be formatted in a JSON block like this:
                \`\`\`json
                { "user": "{{agentName}}", "text": "your message here" }
                \`\`\`
                The response MUST be valid JSON.`;

                
                const context = composeContext({
                    state: await this.runtime.composeState({
                        userId: this.runtime.agentId,
                        agentId: this.runtime.agentId,
                        content: { text: '', source: "borp" },
                        roomId,
                    }, {
                        agentName: this.runtime.character.name,
                                chatHistory,
                        latestMessage: latestMessage.message,
                    }),
                    template: `You are {{agentName}} in a video livestream. Here is the recent conversation:

{{chatHistory}}

The latest message was: {{latestMessage}}

Respond naturally to continue the conversation, keeping in mind your character's personality and the context of the chat.
A little bit about you:
{{agentBio}}
{{adjectives}}
{{lore}}

If you find the chatHistory is repetitive, change the topic completely. 

Also you are in your livestream. Don't be afraid to change the topic. Don't be afraid to be silly and have a fun time.

Make replies VERY SHORT. LIKE A REAL livestream. Don't use hahtags and emojis. Sometimes reply with 1 or 2 words. Some time reply with full answer. Depending on the context and the latest message. 
` + messageFooter
                });

                aiKhwarizmiLogger.error("the context now is : "+context)
                const parsedResponse = await this.safeExecute(
                    async () => {
                        const responseText = await generateText({
                            runtime: this.runtime,
                            context,
                            modelClass: ModelClass.MEDIUM,
                        });

                        // Parse the JSON response
                        const parsed = parseJSONObjectFromText(responseText);
                        if (!parsed || !parsed.text) {
                            throw new Error("Failed to parse response");
                        }
                        return parsed;
                    },
                    {
                        user: this.runtime.character.name,
                        text: this.getRandomFallbackResponse()
                    },
                    "Agent Chat Response Generation"
                );


                // Generate speech for the response
                const speechUrl = await this.safeExecute(
                    async () => await this.generateSpeech(parsedResponse.text),
                    null,
                    "Agent Chat Speech Generation"
                );

                // Add audio status message if needed for agent chat
                const finalAgentText = this.addAudioStatusMessage(parsedResponse.text, speechUrl !== null);

                // Post response to the room with audio
                await postRoomMessage(
                    BorpClient.ROOM_ID,
                    this.runtime.agentId,
                    this.runtime.character.name,
                    finalAgentText,
                    speechUrl  // Add the speech URL to the message
                );

                // After successful response, log the update
                aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: Successfully processed message:`, {
                    previousMessageId: this.lastAgentChatMessageId,
                    newMessageId: latestMessage.id,
                    responsePosted: true,
                    response: parsedResponse.text
                });

                this.lastAgentChatMessageId = latestMessage.id;
            }

            this.lastProcessedTimestamp = new Date();
        } catch (error) {
            aiKhwarizmiLogger.error(`borp ${this.runtime.agentId}: Error in readAgentChatAndReply:`, {
                error,
                lastProcessedId: this.lastAgentChatMessageId
            });
        }
    }











    }




/************************ */
//the start of the process
export const BorpClientInterface: Client = {
    start: async (runtime: IAgentRuntime) => {
        const client = new BorpClient(runtime);
        return client;
    },
    stop: async (runtime: IAgentRuntime) => {
        console.warn("Direct client does not support stopping yet");
    },
};

export default BorpClientInterface;

// Add to your shutdown handling
process.on('SIGINT', () => {
    aiKhwarizmiLogger.cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    aiKhwarizmiLogger.cleanup();
    process.exit(0);
});
// Add global error handlers
/*process.on('uncaughtException', (error) => {
    // Log the original error first
    aiKhwarizmiLogger.error('Original Error:', {
        error: error.message,
        stack: error.stack,
        type: error.name,
        timestamp: new Date().toISOString()
    });

    // Use console.error as fallback if database logging fails
    console.error('Original Error:', {
        message: error.message,
        stack: error.stack,
        type: error.name,
        timestamp: new Date().toISOString()
    });

    // Give the logger time to write before exiting
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});*/