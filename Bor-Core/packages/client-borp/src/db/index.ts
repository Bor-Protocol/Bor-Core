import { IAgentRuntime } from '@algo3b/aikhwarizmi/src/utils/types.ts';
import { SERVER_URL, SERVER_ENDPOINTS } from '../constants.ts';

export interface IComment {
  id: string;
  agentId: string;
  user: string;
  message: string;
  createdAt: Date;
  readByAgent: boolean;
  avatar?: string;
  handle?: string;
}

// Define the return type interface
export interface FetchCommentsResponse {
  success: boolean;
  comments?: IComment[];
  error?: string;
}

// Add this interface before the markCommentsAsRead function
export interface MarkCommentsReadResponse {
  success: boolean;
  modifiedCount?: number;
  error?: string;
}


export async function fetchStreamComments(
  agentId: string, 
  since: Date,
  limit: number = 15
) {
  try {
    const url = SERVER_ENDPOINTS.GET.UNREAD_COMMENTS(agentId) + 
      `?since=${since.toISOString()}&` +
      `limit=${limit}`;
    console.log("fetchUnreadComments: FETCH", { url });
    const response = await fetch(url);

      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
  } catch (error) {
      console.error("Error fetching unread comments:", error);
      return { comments: [] };
  }
}


export async function fetchUnreadComments(
  agentId: string, 
  since: Date,
  limit: number = 15
) {
  try {
    const url = SERVER_ENDPOINTS.GET.UNREAD_COMMENTS(agentId) + 
      `?since=${since.toISOString()}&` +
      `limit=${limit}`;
    console.log("fetchUnreadComments: FETCH", { url });
    const response = await fetch(url);

      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
  } catch (error) {
      console.error("Error fetching unread comments:", error);
      return { comments: [] };
  }
}

export async function markCommentsAsRead(commentIds: string[]): Promise<MarkCommentsReadResponse> {
  try {
    const response = await fetch(SERVER_ENDPOINTS.POST.MARK_COMMENTS_READ, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ commentIds }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      modifiedCount: data.modifiedCount
    };
  } catch (error) {
    console.error('Error marking comments as read:', error);
    return { success: false, error: 'Failed to mark comments as read' };
  }
}














// Agent chat
export interface IRoomMessage {
  id: string;
  roomId: string;
  agentId: string;
  agentName: string;
  message: string;
  createdAt: Date;
  readByAgent: boolean;
  speechUrl?: string;
}

export interface FetchRoomMessagesResponse {
  success: boolean;
  messages?: IRoomMessage[];
  error?: string;
}

export async function fetchRoomMessages(
  roomId: string,
  limit: number = 15
): Promise<FetchRoomMessagesResponse> {
  try {
    const url = `${SERVER_URL}/api/rooms/${roomId}/messages?limit=${limit}`;
    console.log("fetchRoomMessages: FETCH", { roomId, url });
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.log("fetchRoomMessages: FAILED", { roomId, status: response.status, error: data.error });
      return { success: false, error: data.error };
    }

    console.log("fetchRoomMessages: SUCCESS", { roomId, messageCount: data.messages?.length });
    return {
      success: true,
      messages: data.messages
    };
  } catch (error) {
    console.error('Error fetching room messages:', error);
    return { success: false, error: 'Failed to fetch room messages' };
  }
}

export interface PostRoomMessageResponse {
  success: boolean;
  message?: IRoomMessage;
  error?: string;
}

export async function postRoomMessage(
  roomId: string,
  agentId: string,
  agentName: string,
  message: string,
  speechUrl?: string
): Promise<PostRoomMessageResponse> {
  try {
    const url = `${SERVER_URL}/api/rooms/${roomId}/messages`;
    console.log("postRoomMessage: POST", { roomId, url, agentId, agentName });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentId,
        agentName,
        message,
        speechUrl
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.log("postRoomMessage: FAILED", { roomId, status: response.status, error: data.error });
      return { success: false, error: data.error };
    }

    console.log("postRoomMessage: SUCCESS", { messageId: data.message?.id });
    return {
      success: true,
      message: data.message
    };
  } catch (error) {
    console.error('Error posting room message:', error);
    return { success: false, error: 'Failed to post room message' };
  }
}