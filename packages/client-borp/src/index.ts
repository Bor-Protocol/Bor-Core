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

// Enhance the interface with task timing information
interface TaskHistoryEntry {
    startTime: Date;
    endTime?: Date;
    taskPlan: string[];
    completedTasks: {
        name: string;
        startTime: Date;
        endTime: Date;
        duration: number; // in milliseconds
    }[];
    failedTasks: {
        name: string;
        startTime: Date;
        endTime: Date;
        duration: number;
        error?: string;
    }[];
    status: 'in-progress' | 'completed' | 'failed';
    duration?: number; // total cycle duration in milliseconds
}

interface StoryState {
    isComplete: boolean;
    currentPhase: 'introduction' | 'development' | 'climax' | 'resolution';
    storyProgress: number; // 0 to 100
}

// Add this interface to define the return type
interface StructuredThoughtResponse {
    thought: string;
    isComplete: boolean;
}

interface ContentPlan {
    topic: string;
    goal: string;
    steps: string[];
    currentStep: number;
    isComplete: boolean;
}

export class BorpClient {
    private currentSubject: string;
    private mode: string;
    interval: NodeJS.Timeout;

    intervalTopLikers: NodeJS.Timeout;
    intervalTotalLikes: NodeJS.Timeout;
    runtime: IAgentRuntime;

    roomId: UUID;


    private taskQueueConstants: string[] = [


        'readChatAndReply',

        'generateFreshThought',

        'generatePeriodicAnimation',
        'startStructuredStory',
        'startStructuredContentGeneration',


    ];

    private lastProcessedTimestamp: Date | undefined;
    private lastAgentChatMessageId: string | null = null;

    // Add this property to the class
    private taskHistory: TaskHistoryEntry[] = [];

    private storyState: StoryState = {
        isComplete: false,
        currentPhase: 'introduction',
        storyProgress: 0
    };

    private contentPlan: ContentPlan = {
        topic: '',
        goal: '',
        steps: [],
        currentStep: 0,
        isComplete: false
    };

    private configReader: ConfigReader;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
        this.roomId = stringToUuid(`borp-stream-${this.runtime.agentId}`);
        this.lastProcessedTimestamp = new Date();
        this.configReader = ConfigReader.getInstance();

        // Get current subject from config
        this.currentSubject = this.configReader.getValue('currentSubject');
        this.mode = this.configReader.getValue('mode');
        // Minimal logging to avoid circular references
        aiKhwarizmiLogger.log("borp: initializing client", {
            agentId: this.runtime.agentId,
            characterName: this.runtime.character.name,
            currentSubject: this.currentSubject
        });
    }

   

    private thoughtHistory: string[] = [];
    private maxThoughtHistory: number = 5; // Keep last 5 thoughts for context

    // Add this method to manage thought history
    private updateThoughtHistory(newThought: string) {
        this.thoughtHistory.push(newThought);
        if (this.thoughtHistory.length > this.maxThoughtHistory) {
            this.thoughtHistory.shift(); // Remove oldest thought
        }
    }

    // Add this method to change subjects periodically
    private async rotateSubject() {
        const subjects = [
            "you are talking about the good things about Tunisia",
            "your are talking about the movieGladiator",
            "you are talking about who you can travel to portugal",
            "You are teaching english"

            /* "space exploration",
             "underwater mysteries",
             "digital consciousness",
             "future technology",
             "ancient civilizations",
             "parallel universes",
             "dream psychology",
             "artificial intelligence",
             "time travel theories",
             "quantum physics"*/
        ];
        this.currentSubject = subjects[Math.floor(Math.random() * subjects.length)];
        this.thoughtHistory = []; // Clear history when changing subjects
        aiKhwarizmiLogger.log(`Changed thought subject to: ${this.currentSubject}`);
    }

    public async startTaskProcessing() {
        try {
            const startTime = new Date();
            if (this.mode === 'startStructuredStory') {
                this.taskQueueConstants = [


                    'startStructuredStory',



                ];
            } else if (this.mode === 'startStructuredContentGeneration') {
                this.taskQueueConstants = [

                    'startStructuredContentGeneration',




                ];
            }
            else if (this.mode === 'normal') {
                this.taskQueueConstants = [


                    'readChatAndReply',

                    'generateFreshThought',

                    'generatePeriodicAnimation',



                ];
            }
            aiKhwarizmiLogger.log("Starting Borp task processing", {
                startTime: startTime.toLocaleString('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'long'
                })
            });

            await new Promise(resolve => setTimeout(resolve, 5000));


            try {
                let taskPlan = await this.generateTheTaskPlan();

                const historyEntry: TaskHistoryEntry = {
                    startTime: new Date(),
                    taskPlan: [...taskPlan],
                    completedTasks: [],
                    failedTasks: [],
                    status: 'in-progress'
                };
                this.taskHistory.push(historyEntry);

                aiKhwarizmiLogger.log("Starting new task cycle", {
                    startTime: historyEntry.startTime.toLocaleString('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'long'
                    }),
                    taskPlan,
                    totalCycles: this.taskHistory.length
                });

                while (taskPlan && taskPlan.length > 0) {
                    let task = taskPlan[0];
                    const taskStartTime = new Date();

                    try {
                        aiKhwarizmiLogger.log(`Starting task: ${task}`, {
                            startTime: taskStartTime.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'long'
                            }),
                            remainingTasks: taskPlan.length
                        });

                        switch (task) {
                            case 'readChatAndReply':
                                await this.readChatAndReply();
                                break;
                            case 'generateFreshThought':
                                await this.generateAndShareFreshThought();
                                break;
                            case 'generatePeriodicAnimation':
                                await this.generateAndSharePeriodicAnimation();
                                break;
                            case 'startStructuredStory':
                                await this.startStructuredStory();
                                break;
                            case 'startStructuredContentGeneration':
                                await this.startStructuredContentGeneration();
                                break;
                        }

                        const taskEndTime = new Date();
                        const taskDuration = taskEndTime.getTime() - taskStartTime.getTime();

                        historyEntry.completedTasks.push({
                            name: task,
                            startTime: taskStartTime,
                            endTime: taskEndTime,
                            duration: taskDuration
                        });

                        aiKhwarizmiLogger.log("Task completed", {
                            task,
                            startTime: taskStartTime.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'long'
                            }),
                            endTime: taskEndTime.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'long'
                            }),
                            duration: `${(taskDuration / 1000).toFixed(2)} seconds`,
                            remainingTasks: taskPlan.length - 1
                        });

                    } catch (taskError) {
                        const taskEndTime = new Date();
                        const taskDuration = taskEndTime.getTime() - taskStartTime.getTime();

                        historyEntry.failedTasks.push({
                            name: task,
                            startTime: taskStartTime,
                            endTime: taskEndTime,
                            duration: taskDuration,
                            error: taskError.message
                        });

                        aiKhwarizmiLogger.error(`Task execution error`, {
                            task,
                            startTime: taskStartTime.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'long'
                            }),
                            endTime: taskEndTime.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'long'
                            }),
                            duration: `${(taskDuration / 1000).toFixed(2)} seconds`,
                            error: taskError
                        });
                    }

                    taskPlan = taskPlan.slice(1);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                historyEntry.endTime = new Date();
                historyEntry.status = 'completed';
                historyEntry.duration = historyEntry.endTime.getTime() - historyEntry.startTime.getTime();

                aiKhwarizmiLogger.log("Task cycle completed", {
                    cycleSummary: {
                        duration: `${(historyEntry.duration / 1000).toFixed(2)} seconds`,
                        startTime: historyEntry.startTime.toLocaleString('en-US', {
                            dateStyle: 'medium',
                            timeStyle: 'long'
                        }),
                        endTime: historyEntry.endTime.toLocaleString('en-US', {
                            dateStyle: 'medium',
                            timeStyle: 'long'
                        }),
                        status: historyEntry.status,
                        taskPlan: historyEntry.taskPlan,
                        completedTasks: historyEntry.completedTasks.map(t => ({
                            name: t.name,
                            duration: `${(t.duration / 1000).toFixed(2)} seconds`,
                            startTime: t.startTime.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'long'
                            }),
                            endTime: t.endTime.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'long'
                            })
                        })),
                        failedTasks: historyEntry.failedTasks.map(t => ({
                            name: t.name,
                            duration: `${(t.duration / 1000).toFixed(2)} seconds`,
                            startTime: t.startTime.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'long'
                            }),
                            endTime: t.endTime.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'long'
                            }),
                            error: t.error
                        }))
                    },
                    currentStats: {
                        averageCycleDuration: `${(this.calculateAverageCycleDuration() / 1000).toFixed(2)} seconds`,
                        taskSuccessRates: this.calculateTaskSuccessRates(),
                        mostTimeConsumingTasks: this.identifyMostTimeConsumingTasks().map(t => ({
                            ...t,
                            averageDuration: `${(t.averageDuration / 1000).toFixed(2)} seconds`,
                            totalDuration: `${(t.totalDuration / 1000).toFixed(2)} seconds`
                        }))
                    }
                });

                if (this.taskHistory.length > 100) {
                    this.taskHistory = this.taskHistory.slice(-100);
                }

                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (cycleError) {
                const currentEntry = this.taskHistory[this.taskHistory.length - 1];
                if (currentEntry && currentEntry.status === 'in-progress') {
                    currentEntry.endTime = new Date();
                    currentEntry.status = 'failed';
                    currentEntry.duration = currentEntry.endTime.getTime() - currentEntry.startTime.getTime();
                }

                aiKhwarizmiLogger.error("Error in task cycle:", {
                    error: cycleError,
                    duration: currentEntry?.duration
                });
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

        } catch (fatalError) {
            aiKhwarizmiLogger.error("Fatal error in task processing:", fatalError);
            await new Promise(resolve => setTimeout(resolve, 10000));
            return this.startTaskProcessing();
        }
    }

    async heartbeat() {
        await this.updateStreamingStatus({
            isStreaming: true,
        });
    }
    // Chat & Message Processing





    async startStructuredStory() {
        const startTime = new Date();
        let isStoryComplete = false;
        const completeStory: string[] = [];
        while (!isStoryComplete) {
            aiKhwarizmiLogger.log(`Generating structured Story`);

            const result = await this.generateStructuredStory();
            completeStory.push(result.thought); // Add each thought to the story array
            isStoryComplete = result.isComplete;

            if (isStoryComplete) {
                // Log the complete story with formatting
                aiKhwarizmiLogger.log("Complete Story Generated:", {
                    subject: this.currentSubject,
                    totalThoughts: completeStory.length,

                    story: {
                        summary: "Story completed successfully",
                        narrative: completeStory.map((thought, index) => ({
                            part: index + 1,
                            thought: thought
                        })),
                        fullText: completeStory.join("\n\n")
                    },
                    finalState: {
                        phase: this.storyState.currentPhase,
                        progress: this.storyState.storyProgress
                    }
                });
                break;
            }
        }
        const endTime = new Date();
        const totalDuration = endTime.getTime() - startTime.getTime();

        aiKhwarizmiLogger.log("Story Task processing finished", {
            startTime: startTime.toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'long'
            }),
            endTime: endTime.toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'long'
            }),
            totalDuration: `${(totalDuration / 1000).toFixed(2)} seconds`
        });

        const historySummary = this.taskHistory.map(cycle => ({
            totalDuration: cycle.duration,
            status: cycle.status,
            startTime: cycle.startTime,
            endTime: cycle.endTime,
            completedTasks: cycle.completedTasks.map(task => ({
                name: task.name,
                duration: task.duration,
                startTime: task.startTime,
                endTime: task.endTime
            })),
            failedTasks: cycle.failedTasks.map(task => ({
                name: task.name,
                duration: task.duration,
                startTime: task.startTime,
                endTime: task.endTime,
                error: task.error
            })),
            taskPlan: cycle.taskPlan
        }));

        aiKhwarizmiLogger.log("Complete Story Task History", {
            totalCycles: this.taskHistory.length,
            averageCycleDuration: this.calculateAverageCycleDuration(),
            cycles: historySummary,
            taskSuccessRates: this.calculateTaskSuccessRates(),
            mostTimeConsumingTasks: this.identifyMostTimeConsumingTasks()
        });
    }
    async readChatAndReply() {
        try {
            // Read Comments since last processed timestamp
            aiKhwarizmiLogger.log(`[${new Date().toLocaleString()}] Borp (${this.runtime.character.name}): Reading chat since`,
                this.lastProcessedTimestamp?.toISOString());

            const { comments } = await fetchUnreadComments(
                this.runtime.agentId,
                this.lastProcessedTimestamp
            );

            if (comments && comments.length > 0) {
                // Process each comment and store it as a memory
                const processedComments = await this.processComments(comments);
                aiKhwarizmiLogger.log("borp: processedComments", {
                    count: processedComments?.length,
                    lastProcessedTimestamp: this.lastProcessedTimestamp?.toISOString()
                });
            }

            // Update the timestamp to current time after processing
            this.lastProcessedTimestamp = new Date();

        } catch (error) {
            aiKhwarizmiLogger.error("Error in readChatAndReply:", error);
        }
    }

    async processComments(comments: IComment[]) {
        aiKhwarizmiLogger.log(comments);
        const commentIds = comments?.map(comment => comment.id) ?? [];

        if (commentIds.length === 0) {
            aiKhwarizmiLogger.log(`borp (${this.runtime.character.name}): No comments to process`);
            return commentIds;
        }

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
            aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: memory created`, { memory });
        }

        // Compose state and check if should respond
        const state = (await this.runtime.composeState(userMessage, {
            agentName: this.runtime.character.name,
            selectedComment,
            animationOptions: getAllAnimations().join(", "),
        })) as State;


        // if there is a selected comment, should respond is true
        let shouldRespond = true;
        if (!selectedComment) {
            shouldRespond = false;
        }

        aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: shouldRespond`, { shouldRespond, selectedCommentId });

        if (shouldRespond) {
            const context = composeContext({
                state,
                template: borpMessageHandlerTemplate,
            });

            const responseContent = await this._generateResponse(memory, state, context);
            responseContent.text = responseContent.text?.trim();

            const responseMessage = {
                ...userMessage,
                userId: this.runtime.agentId,
                content: responseContent,
            };

            await this.runtime.messageManager.createMemory(responseMessage);
            aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: reply memory created`, { responseMessage });



            // Generate and post animation
            const _borpAnimationTemplate = borpMessageAnimationTemplate({
                agentName: this.runtime.character.name,
                lastMessage: responseContent.text,
                animationOptions: getAllAnimations().join(", "),
            });

            // aiKhwarizmiLogger.log(`Generated template animation: ${_borpAnimationTemplate}`);
            // return _borpAnimationTemplate;

            const animationResponse = await generateText({
                runtime: this.runtime,
                context: _borpAnimationTemplate,
                modelClass: ModelClass.SMALL,
            });

            const animationBody = {
                agentId: this.runtime.agentId,
                animation: animationResponse,
            }


            // Generate and post speech
            let speechUrl;
            try {
                speechUrl = await this.generateSpeech(responseContent.text);
            } catch (error) {
                aiKhwarizmiLogger.error(`borp ${this.runtime.agentId}: Failed to generate speech`, { error });
            }
            // Post response
            const body: AIResponse = {
                // Required fields
                id: stringToUuid(`${this.runtime.agentId}-${Date.now()}`),
                text: responseContent.text,
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


            const fetchResponse = await fetch(SERVER_ENDPOINTS.POST.AI_RESPONSES, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': api_key
                },
                body: JSON.stringify(body),
            });


            if (fetchResponse.status !== 200) {
                aiKhwarizmiLogger.error(`borp ${this.runtime.agentId}: Failed to post response to api`, { fetchResponse });
            } else {
                aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: CHAT REPLY: Posted message response to api`, { responseContent, body });
            }
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

        const selectedCommentId = await generateText({
            runtime: this.runtime,
            context: selectContext,
            modelClass: ModelClass.MEDIUM
        });

        aiKhwarizmiLogger.log("borp: selectedCommentId", { selectedCommentId });

        return selectedCommentId === "NONE" ? null : selectedCommentId;
    }
    private async _generateResponse(
        message: Memory,
        state: State,
        context: string
    ): Promise<Content> {
        const { userId, roomId } = message;


        const response = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.MEDIUM,
        });

        if (!response) {
            aiKhwarizmiLogger.error("No response from generateMessageResponse");
            return;
        }

        await this.runtime.databaseAdapter.log({
            body: { message, context, response },
            userId: userId,
            roomId,
            type: "response",
        });

        return response;
    }
    async generateSpeech(text: string): Promise<string> {
        // aiKhwarizmiLogger.log("borp: generateSpeech", { text });
        /* const agentName = this.runtime.character.name;
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
             return publicUrl;*/
        return "https://borstorage.b-cdn.net/speech/1737312298831.mp3";
        // } catch (error) {
        //  aiKhwarizmiLogger.error(`borp (${agentName}): error sending audio to server`, error);
        throw new Error("Failed to upload audio");
        // }
    }




    private async _makeApiCall(endpoint: string, method: string, body?: any) {
        try {
            const response = await fetch(`${SERVER_URL}${endpoint}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${api_key}`,
                    'api_key': api_key
                },
                body: body ? JSON.stringify(body) : undefined,
            });

            if (!response.ok) {
                throw new Error(`API call failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return { success: true, data };
        } catch (error) {
            aiKhwarizmiLogger.error(`borp ${this.runtime.agentId}: API call failed`, { endpoint, error });
            return { success: false, error };
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






    private async generateAndShareFreshThought() {
        try {
            // Generate the thought
            const thoughtText = await this.generateFreshThought();
            if (!thoughtText) return;

            // Create memory for the thought
            const thoughtMemory: Memory = {
                id: stringToUuid(`thought-${this.runtime.agentId}-${Date.now()}`),
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                roomId: this.roomId,
                content: {
                    text: thoughtText,
                    source: "borp",
                    metadata: {
                        isThought: true,
                        timestamp: new Date().toISOString()
                    }
                },
                createdAt: Date.now(),
                embedding: embeddingZeroVector,
            };
            // Store the memory
            await this.runtime.messageManager.createMemory(thoughtMemory);

            // Log memory without embedding
            const { embedding, ...memoryWithoutEmbedding } = thoughtMemory;
            aiKhwarizmiLogger.log(`borp ${this.runtime.agentId}: Created memory for fresh thought`, {
                thoughtMemory: memoryWithoutEmbedding
            });

            // Generate speech
            let speechUrl;
            try {
                speechUrl = await this.generateSpeech(thoughtText);
            } catch (error) {
                aiKhwarizmiLogger.error("Error generating speech:", error);
                speechUrl = undefined;
            }

            // Prepare the response body
            const body: AIResponse = {
                id: stringToUuid(`${this.runtime.agentId}-${Date.now()}`),
                text: thoughtText,
                agentId: this.runtime.agentId,
                thought: true,  // New flag to identify fresh thoughts
                audioUrl: speechUrl,
            };

            // Post the thought
            const fetchResponse = await fetch(SERVER_ENDPOINTS.POST.AI_RESPONSES, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': api_key
                },
                body: JSON.stringify(body),
            });

            if (!fetchResponse.ok) {
                aiKhwarizmiLogger.error("Failed to post fresh thought:", await fetchResponse.text());
            }

        } catch (error) {
            aiKhwarizmiLogger.error("Error in generateAndShareFreshThought:", error);
        }
    }



    private async generateFreshThought(): Promise<string> {


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


        const context = composeContext({
            state: await this.runtime.composeState({
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: { text: '', source: "borp" },
                roomId: this.roomId,
            }, {
                agentName: this.runtime.character.name,
                bio: randomBioParts.join(', '),
                lore: randomLoreParts.join(', '), // Join the random parts into a string
                adjectives: this.runtime.character.adjectives,
            }),
            template: `
# Task: Generate a UNIQUE and SPONTANEOUS thought for {{agentName}}'s livestream

## Character Profile:
- **Name**: {{agentName}}
- **Traits**: {{adjectives}}
- **Background**: {{lore}}
- **About**: {{bio}}

## Context:
{{agentName}} is live streaming and wants to share a spontaneous thought with chat.

## Instructions:
1. Generate a COMPLETELY UNIQUE thought - avoid common patterns or repetitive formats
2. Choose ONE random approach from these options:
   - A sudden realization about something from {{agentName}}'s background
   - A random observation about the stream or chat
   - A quirky thought that just popped into their head
   - A spontaneous idea or plan
   - A memory that just surfaced
   - A reaction to something they imagined
   - Breaking the 4th wall in a fun way
   - An unexpected topic change
3. Make it feel natural and unscripted
4. Keep it between 3-60 words
5. NO hashtags or emojis
6. Each thought should feel different from the last
7. sometimes tell a story. Sometimes ask a question, sometime just say silly things

## Response Format:
Return only the thought, no explanations or formatting.
            `,
        });


        // aiKhwarizmiLogger.log(`Generated template: ${context}`);


        const thoughtText = await generateText({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.MEDIUM,
        });

        aiKhwarizmiLogger.log(`Generated Fresh Thought: ${thoughtText}`);
        return thoughtText;
    }



    private async generateTheTaskPlan(): Promise<string[]> {





        const context = composeContext({
            state: await this.runtime.composeState({
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: { text: '', source: "borp" },
                roomId: this.roomId,
            }, {
                agentName: this.runtime.character.name,
                tasks: this.taskQueueConstants,
                adjectives: this.runtime.character.adjectives,
            }),
            template: `
# Task Plan for {{agentName}}  

## Objective:  
Generate a prioritized list of actions for {{agentName}}.  

## Available Actions:  
Must be one of these tasks:  
{{tasks}}  

## Instructions:  
1. Always return only the structured task list random with minimum 6 tasks. Never return null.  

## Example Output Format:  
json  
{  
  "taskQueueConstants": [  
    {  
      "name": "one of the tasks",  

    },  
    {  
      "name": "one of the tasks",  
    
    },  
    {  
      "name": "one of the tasks",  
    
    }  
  ]  
}`,
        });


        // aiKhwarizmiLogger.log(`Generated template: ${context}`);


        const thoughtText = await generateText({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.MEDIUM,
        });

        aiKhwarizmiLogger.log(`Generated Task Plan: ${thoughtText}`);

        // Parse the JSON from the markdown code block
        const jsonString = thoughtText
            .replace(/^```json\n/, '')  // Remove starting ```json
            .replace(/\n```$/, '');     // Remove ending ```

        const parsed = JSON.parse(jsonString);

        // Extract just the names into an array
        const namesArray = parsed.taskQueueConstants.map(item => item.name);

        aiKhwarizmiLogger.log(namesArray);
        return namesArray;
    }
    private async generateStructuredStory(): Promise<StructuredThoughtResponse> {
        const context = composeContext({
            state: await this.runtime.composeState({
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: { text: '', source: "borp" },
                roomId: this.roomId,
            }, {
                agentName: this.runtime.character.name,
                previousThoughts: this.thoughtHistory || [],
                currentSubject: this.currentSubject,
                currentPhase: this.storyState.currentPhase,
                storyProgress: this.storyState.storyProgress,
            }),
            template: `
# Task: Generate a Structured Story Thought

Current Progress: ${this.storyState.storyProgress}%
Current Phase: ${this.storyState.currentPhase}

## Instructions:
1. Generate the next story thought
2. Progress must increase with each thought:
   - Introduction (0-25%)
   - Development (26-50%)
   - Climax (51-75%)
   - Resolution (76-100%)
3. Story MUST complete at 100%
4. Each thought must advance the progress by 10-25%

Return JSON:
\`\`\`json
{
    "thought": "your thought here",
    "storyProgress": <next_progress_number>,
    "phase": "<current_phase>",
    "isComplete": <true_when_100%>
}
\`\`\`
`
        });

        const response = await generateText({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.MEDIUM,
        });

        try {
            const cleanResponse = response
                .replace(/^```json\n/, '')
                .replace(/\n```$/, '')
                .trim();

            const parsed = JSON.parse(cleanResponse);
            
            // Update story state with bounds checking
            this.storyState.storyProgress = Math.min(parsed.storyProgress, 100); // Ensure progress doesn't exceed 100
            this.storyState.currentPhase = parsed.phase;
            
            // Set isComplete when we reach 100% progress
            this.storyState.isComplete = this.storyState.storyProgress >= 100;

            if (this.storyState.isComplete) {
                aiKhwarizmiLogger.log(`Story is complete..`);
            } else {
                this.updateThoughtHistory(parsed.thought);
            }
            aiKhwarizmiLogger.log(`Generated structured thought:`, {
                thought: parsed.thought,
                storyProgress: parsed.storyProgress,
                phase: parsed.phase,
                isComplete: parsed.isComplete
            });
            return {
                thought: parsed.thought,
                isComplete: this.storyState.isComplete
            };
        } catch (error) {
            aiKhwarizmiLogger.error("Error parsing structured thought response:", {
                error,
                rawResponse: response
            });
            return {
                thought: "Let me gather my thoughts...",
                isComplete: false
            };
        }
    }

    // make random animations each time 
    private async generateAndSharePeriodicAnimation() {
        try {
            // Combine all animations into one array
            const allAnimations = [
                ...ANIMATION_OPTIONS.DANCING,
                ...ANIMATION_OPTIONS.HEAD,
                ...ANIMATION_OPTIONS.GESTURES,
                ...ANIMATION_OPTIONS.SPECIAL
            ];

            // Randomly select 10 unique animations
            const randomAnimations = allAnimations
                .sort(() => Math.random() - 0.5)
                .slice(0, 10);

            const context = composeContext({
                state: await this.runtime.composeState({
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: { text: '', source: "borp" },
                    roomId: this.roomId,
                }, {
                    agentName: this.runtime.character.name,
                    bio: this.runtime.character.bio,
                    adjectives: this.runtime.character.adjectives,
                    availableAnimations: randomAnimations.join(', ')
                }),
                template: borpAnimationTemplate
            });

            // aiKhwarizmiLogger.log(`Generated template animation: ${context}`);
            // return context;

            const animation = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });
            aiKhwarizmiLogger.log(`Generated template animation: ${animation}`);
            // return animation;

            // Validate the animation is in our list
            const cleanAnimation = animation.trim().toLowerCase();
            if (!getAllAnimations().includes(cleanAnimation)) {
                aiKhwarizmiLogger.warn(`Invalid animation generated: ${cleanAnimation}, defaulting to 'idle'`);
                return;
            }

            aiKhwarizmiLogger.log(`Generated cleanAnimation animation: ${cleanAnimation}`);
            // return cleanAnimation;

            // Post the animation
            const response = await fetch(SERVER_ENDPOINTS.POST.UPDATE_ANIMATION, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': api_key
                },
                body: JSON.stringify({
                    agentId: this.runtime.agentId,
                    animation: cleanAnimation,
                }),
            });

            if (!response.ok) {
                aiKhwarizmiLogger.error("Failed to post periodic animation:", await response.text());
            }
        } catch (error) {
            aiKhwarizmiLogger.error("Error in generateAndSharePeriodicAnimation:", error);
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


                const responseText = await generateText({
                    runtime: this.runtime,
                    context,
                    modelClass: ModelClass.MEDIUM,
                });

                // Parse the JSON response
                const parsedResponse = parseJSONObjectFromText(responseText);
                if (!parsedResponse || !parsedResponse.text) {
                    aiKhwarizmiLogger.error(`borp ${this.runtime.agentId}: Failed to parse response:`, responseText);
                    return;
                }


                // Generate speech for the response
                let speechUrl;
                try {
                    speechUrl = await this.generateSpeech(parsedResponse.text);
                } catch (error) {
                    aiKhwarizmiLogger.error(`borp ${this.runtime.agentId}: Failed to generate speech`, { error });
                }

                // Post response to the room with audio
                await postRoomMessage(
                    BorpClient.ROOM_ID,
                    this.runtime.agentId,
                    this.runtime.character.name,
                    parsedResponse.text,
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

    // Add a method to get task history
    public getTaskHistory(): TaskHistoryEntry[] {
        return this.taskHistory;
    }

    // Add a method to get current cycle status
    public getCurrentCycleStatus(): TaskHistoryEntry | null {
        return this.taskHistory.length > 0 ?
            this.taskHistory[this.taskHistory.length - 1] :
            null;
    }

    // Add these helper methods to calculate statistics
    private calculateAverageCycleDuration(): number {
        const completedCycles = this.taskHistory.filter(cycle => cycle.duration);
        if (completedCycles.length === 0) return 0;

        const totalDuration = completedCycles.reduce((sum, cycle) => sum + cycle.duration!, 0);
        return totalDuration / completedCycles.length;
    }

    private calculateTaskSuccessRates(): Record<string, {
        success: number,
        failed: number,
        rate: string
    }> {
        const taskStats: Record<string, { success: number, failed: number }> = {};

        // Count successes and failures for each task type
        this.taskHistory.forEach(cycle => {
            cycle.completedTasks.forEach(task => {
                if (!taskStats[task.name]) {
                    taskStats[task.name] = { success: 0, failed: 0 };
                }
                taskStats[task.name].success++;
            });

            cycle.failedTasks.forEach(task => {
                if (!taskStats[task.name]) {
                    taskStats[task.name] = { success: 0, failed: 0 };
                }
                taskStats[task.name].failed++;
            });
        });

        // Calculate success rates
        return Object.entries(taskStats).reduce((acc, [taskName, stats]) => {
            const total = stats.success + stats.failed;
            const rate = total > 0 ? ((stats.success / total) * 100).toFixed(1) : '0';
            acc[taskName] = {
                ...stats,
                rate: `${rate}%`
            };
            return acc;
        }, {} as Record<string, { success: number, failed: number, rate: string }>);
    }

    private identifyMostTimeConsumingTasks(): Array<{
        taskName: string,
        averageDuration: number,
        totalDuration: number,
        executionCount: number
    }> {
        const taskStats: Record<string, {
            totalDuration: number,
            count: number
        }> = {};

        // Aggregate durations for all tasks (both completed and failed)
        this.taskHistory.forEach(cycle => {
            [...cycle.completedTasks, ...cycle.failedTasks].forEach(task => {
                if (!taskStats[task.name]) {
                    taskStats[task.name] = { totalDuration: 0, count: 0 };
                }
                taskStats[task.name].totalDuration += task.duration;
                taskStats[task.name].count++;
            });
        });

        // Convert to array and calculate averages
        return Object.entries(taskStats)
            .map(([taskName, stats]) => ({
                taskName,
                averageDuration: stats.count > 0 ? stats.totalDuration / stats.count : 0,
                totalDuration: stats.totalDuration,
                executionCount: stats.count
            }))
            .sort((a, b) => b.totalDuration - a.totalDuration);
    }

    private async generateStructuredContent(): Promise<StructuredThoughtResponse> {
        const context = composeContext({
            state: await this.runtime.composeState({
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: { text: '', source: "borp" },
                roomId: this.roomId,
            }, {
                agentName: this.runtime.character.name,
                previousThoughts: this.thoughtHistory || [],
                currentSubject: this.currentSubject,
                currentStep: this.contentPlan.currentStep,
                contentPlan: this.contentPlan,
            }),
            template: `
# Task: Generate Structured Content for {{agentName}}'s livestream

## Content Context
Subject: {{currentSubject}}
${this.contentPlan.currentStep > 0 ? `
Previous Content:
${this.thoughtHistory.map((thought, i) => `${i + 1}. ${thought}`).join('\n')}

Current Goal: ${this.contentPlan.goal}
Current Step (${this.contentPlan.currentStep} of ${this.contentPlan.steps.length}): 
${this.contentPlan.steps[this.contentPlan.currentStep - 1]}
` : ''}

## Instructions
${this.contentPlan.currentStep === 0 ? `
1. Analyze the subject "${this.currentSubject}" and create a content plan:
   - Determine the type (review, tutorial, story, etc.)
   - Set a clear goal (inform, persuade, entertain)
   - Create nombre <10 logical steps to reach that goal
   - Each step should naturally flow into the next
   - Consider how to maintain viewer engagement
` : `
1. Generate the next part of your content:
   - Use natural transitions from previous thoughts
   - Stay focused on the current step: "${this.contentPlan.steps[this.contentPlan.currentStep - 1]}"
   - Maintain a conversational, engaging tone
   - Build towards the final goal: "${this.contentPlan.goal}"
`}

2. Keep responses natural and engaging
3. Use connecting phrases between thoughts
4. Maintain a clear narrative thread
5. Keep each response between 3-60 words

## Response Format:
Return JSON in this format:
\`\`\`json
{
    ${this.contentPlan.currentStep === 0 ? `
    "thought": "Initial engaging introduction to the topic",
    "contentPlan": {
        "topic": "Specific topic focus",
        "goal": "Clear end goal",
        "steps": ["Step 1", "Step 2", "Step 3", "Step 4"]
    },
    "currentStep": 1` : `
    "thought": "Your next connected thought",
    "currentStep": ${this.contentPlan.currentStep + 1}`}
    ${this.contentPlan.currentStep > 0 ? `,
    "transition": "Brief transition from previous thought"` : ''},
    "isComplete": ${this.contentPlan.currentStep >= (this.contentPlan.steps?.length || 0) - 1 ? "true" : "false"}
}
\`\`\`
`
        });

        const response = await generateText({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.MEDIUM,
        });

        try {
            const cleanResponse = response
                .replace(/^```json\n/, '')
                .replace(/\n```$/, '')
                .trim();

            const parsed = JSON.parse(cleanResponse);

            // Initialize content plan on first step
            if (this.contentPlan.currentStep === 0 && parsed.contentPlan) {
                this.contentPlan = {
                    ...parsed.contentPlan,
                    currentStep: 1,
                    isComplete: false
                };
                aiKhwarizmiLogger.log("Content plan initialized:", {
                    plan: this.contentPlan,
                    firstThought: parsed.thought
                });
            } else {
                // For subsequent steps, include transition if available
                const thoughtWithTransition = parsed.transition ?
                    `${parsed.transition} ${parsed.thought}` :
                    parsed.thought;

                this.contentPlan.currentStep = parsed.currentStep;
                this.contentPlan.isComplete = parsed.isComplete;

                aiKhwarizmiLogger.log("Content progress:", {
                    step: this.contentPlan.currentStep,
                    totalSteps: this.contentPlan.steps.length,
                    thought: thoughtWithTransition
                });
            }

            this.updateThoughtHistory(parsed.thought);

            return {
                thought: parsed.thought,
                isComplete: this.contentPlan.isComplete
            };
        } catch (error) {
            aiKhwarizmiLogger.error("Error parsing structured content response:", {
                error,
                rawResponse: response
            });
            return {
                thought: "Let me gather my thoughts...",
                isComplete: false
            };
        }
    }

    // Add this method to use the structured content generator
    public async startStructuredContentGeneration() {
        try {
            const startTime = new Date();
            aiKhwarizmiLogger.log("Starting structured content generation", {
                subject: this.currentSubject,
                startTime: startTime.toLocaleString()
            });

            let isComplete = false;
            const completeContent: string[] = [];

            while (!isComplete) {
                const result = await this.generateStructuredContent();
                completeContent.push(result.thought);
                isComplete = result.isComplete;

                if (isComplete) {
                    aiKhwarizmiLogger.log("Content Generation Completed:", {
                        subject: this.currentSubject,
                        goal: this.contentPlan.goal,
                        totalSteps: this.contentPlan.steps.length,
                        content: {
                            summary: "Content generated successfully",
                            steps: this.contentPlan.steps,
                            narrative: completeContent.map((thought, index) => ({
                                step: index + 1,
                                stepName: this.contentPlan.steps[index],
                                content: thought
                            })),
                            fullText: completeContent.join("\n\n")
                        },
                        finalState: {
                            totalSteps: this.contentPlan.steps.length,
                            completedSteps: completeContent.length,
                            goal: this.contentPlan.goal
                        }
                    });
                    break;
                }

                // Add a small delay between thoughts to simulate natural pacing
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

        } catch (error) {
            aiKhwarizmiLogger.error("Error in content generation:", error);
        }
    }
     // Add method to refresh config without restarting the agent to be used
     public refreshConfig() {
        this.configReader.reloadConfig();
        this.currentSubject = this.configReader.getValue('currentSubject');
        aiKhwarizmiLogger.log("Configuration refreshed", {
            newSubject: this.currentSubject
        });
    }
}


/************************ */
//the start of the process
export const BorpClientInterface: Client = {
    start: async (runtime: IAgentRuntime) => {
        try {
            const client = new BorpClient(runtime);

            // Start the task processing loop with error handling
            client.startTaskProcessing().catch(error => {
                aiKhwarizmiLogger.error("Error starting task processing:", error);
                // Instead of exiting, log the error and let the process continue running
                aiKhwarizmiLogger.warn("Task processing failed but client will continue running");
            });

            return client;
        } catch (error) {
            aiKhwarizmiLogger.error("Error creating Borp client:", error);
            throw error;
        }
    },
    stop: async (runtime: IAgentRuntime) => {
        aiKhwarizmiLogger.warn("Direct client does not support stopping yet");
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


