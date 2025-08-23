export const PORT = 6969;
export const SERVER_URL = process.env.BORP_SERVER_URL 
export const SERVER_ENDPOINTS = {
    POST: {
        AI_RESPONSES: `${SERVER_URL}/api/ai-responses`,
        UPDATE_ANIMATION: `${SERVER_URL}/api/update-animation`,
        UPDATE_STREAMING_STATUS: `${SERVER_URL}/api/streaming/status`,
        MARK_COMMENTS_READ: `${SERVER_URL}/api/comments/mark-read`,
        AGENTS_AUDIO: `${SERVER_URL}/api/agents/audio`,
    },
    GET: {
        UNREAD_COMMENTS: (agentId: string) => 
            `${SERVER_URL}/api/streams/${agentId}/unread-comments`
    }
}


export const getAllAnimations = () => {
    const allAnimations = [
        ...ANIMATION_OPTIONS.IDLE,
        ...ANIMATION_OPTIONS.HEAD,
        ...ANIMATION_OPTIONS.GESTURES,
        ...ANIMATION_OPTIONS.DANCING,
        ...ANIMATION_OPTIONS.SPECIAL
    ];
    
    // Fisher-Yates shuffle
    const shuffled = [...allAnimations];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // Return first 20 items (or all if less than 20)
    return shuffled.slice(0, 20);
}


export const ANIMATION_OPTIONS = {
    // Basic states
    IDLE: [
        "idle",
        "idle-2", 
        "idle_basic", 
        "idle_dwarf",
        "offensive_idle",
        "idlet"
    ],

    // Head movements 
    HEAD: [
        "acknowledging",
        "hard_head_nod",
        "head_nod_yes", 
        "lengthy_head_nod",
        "sarcastic_head_nod",
        "shaking_head_no",
        "thoughtful_head_shake",
        "annoyed_head_shake"
    ],

    // Gestures
    GESTURES: [
        "angry_gesture",
        "being_cocky",
        "dismissing_gesture", 
        "happy_hand_gesture",
        "look_away_gesture",
        "relieved_sigh",
        "standing_clap",
        "blow_a_kiss"
    ],

    // Dancing
    DANCING: [
        "dancing_twerk",
        "hip_hop_dancing",
        "rumba_dancing",
        "silly_dancing",
        "capoeira",
        "belly_dance",
        "maraschino",
        "hiphop_dancing",
        "robot_dance",
        "swing_dancing",
        "chicken_dance",
        "fortnite",
        "bboy_hiphopmove",
        "light_dance",
        "trump_dance"
    ],

    // Sitting poses
    SITTING: [
        "sitting",
        "sitting_disbelief",
        "sitting_legs_swinging",
        "sitting_yell"
    ],

    // Special actions
    SPECIAL: [
        "appearing",
        "floating", 
        "joyful_jump",
        "laughing",
        "got_assasinated",
        "walk_with_rifle",
        "weight_shift",
        "defeated",
        "praying",
        "angry",
        "happy_idle",
        "nervously_look_around",
        "arm_stretching",
        "salute",
        "excited",
        "greeting",
        "arguing",
        "youre_loser",
        "look_around",
        "saying_no",
        "shaking_hands",
        "insulting",
        "threatening",
        "happy",
        "are_you_crazy",
        "focusing",
        "speedbag_boxing",
        "pointing",
        "hands_up",
        "listening_to_music",
        "play_golf",
        "cheering",
        "fist_up"
    ]
};
