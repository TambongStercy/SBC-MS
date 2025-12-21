import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

interface SocketContextType {
    socket: Socket | null;
    isConnected: boolean;
    onlineUsers: Set<string>;
    joinConversation: (conversationId: string) => void;
    leaveConversation: (conversationId: string) => void;
    sendMessage: (data: { conversationId: string; content: string; type?: string }) => void;
    sendTypingStart: (conversationId: string) => void;
    sendTypingStop: (conversationId: string) => void;
    markMessagesRead: (conversationId: string, messageIds?: string[]) => void;
    subscribeToStatuses: (categories?: string[]) => void;
    unsubscribeFromStatuses: (categories?: string[]) => void;
    likeStatus: (statusId: string) => void;
    unlikeStatus: (statusId: string) => void;
    repostStatus: (statusId: string) => void;
    viewStatus: (statusId: string) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

interface SocketProviderProps {
    children: ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
    const { token, isAdminAuthenticated } = useAuth();

    useEffect(() => {
        if (!isAdminAuthenticated || !token) {
            if (socket) {
                socket.disconnect();
                setSocket(null);
                setIsConnected(false);
            }
            return;
        }

        const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3008';

        const newSocket = io(socketUrl, {
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });

        newSocket.on('connect', () => {
            console.log('Socket connected:', newSocket.id);
            setIsConnected(true);
        });

        newSocket.on('disconnect', (reason) => {
            console.log('Socket disconnected:', reason);
            setIsConnected(false);
        });

        newSocket.on('connect_error', (error) => {
            console.error('Socket connection error:', error.message);
            setIsConnected(false);
        });

        newSocket.on('user:online', ({ userId }: { userId: string }) => {
            setOnlineUsers(prev => new Set(prev).add(userId));
        });

        newSocket.on('user:offline', ({ userId }: { userId: string }) => {
            setOnlineUsers(prev => {
                const updated = new Set(prev);
                updated.delete(userId);
                return updated;
            });
        });

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, [isAdminAuthenticated, token]);

    const joinConversation = useCallback((conversationId: string) => {
        socket?.emit('conversation:join', conversationId);
    }, [socket]);

    const leaveConversation = useCallback((conversationId: string) => {
        socket?.emit('conversation:leave', conversationId);
    }, [socket]);

    const sendMessage = useCallback((data: { conversationId: string; content: string; type?: string }) => {
        socket?.emit('message:send', data);
    }, [socket]);

    const sendTypingStart = useCallback((conversationId: string) => {
        socket?.emit('typing:start', conversationId);
    }, [socket]);

    const sendTypingStop = useCallback((conversationId: string) => {
        socket?.emit('typing:stop', conversationId);
    }, [socket]);

    const markMessagesRead = useCallback((conversationId: string, messageIds?: string[]) => {
        socket?.emit('message:read', { conversationId, messageIds });
    }, [socket]);

    const subscribeToStatuses = useCallback((categories?: string[]) => {
        socket?.emit('status:subscribe', categories);
    }, [socket]);

    const unsubscribeFromStatuses = useCallback((categories?: string[]) => {
        socket?.emit('status:unsubscribe', categories);
    }, [socket]);

    const likeStatus = useCallback((statusId: string) => {
        socket?.emit('status:like', statusId);
    }, [socket]);

    const unlikeStatus = useCallback((statusId: string) => {
        socket?.emit('status:unlike', statusId);
    }, [socket]);

    const repostStatus = useCallback((statusId: string) => {
        socket?.emit('status:repost', statusId);
    }, [socket]);

    const viewStatus = useCallback((statusId: string) => {
        socket?.emit('status:view', statusId);
    }, [socket]);

    return (
        <SocketContext.Provider value={{
            socket,
            isConnected,
            onlineUsers,
            joinConversation,
            leaveConversation,
            sendMessage,
            sendTypingStart,
            sendTypingStop,
            markMessagesRead,
            subscribeToStatuses,
            unsubscribeFromStatuses,
            likeStatus,
            unlikeStatus,
            repostStatus,
            viewStatus
        }}>
            {children}
        </SocketContext.Provider>
    );
};

export const useSocket = (): SocketContextType => {
    const context = useContext(SocketContext);
    if (context === undefined) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
};
