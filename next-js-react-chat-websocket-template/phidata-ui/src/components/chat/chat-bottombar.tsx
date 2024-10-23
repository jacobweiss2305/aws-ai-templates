import { Mic } from "lucide-react";
import Link from "next/link";
import React, { useRef, useState, useEffect } from "react";
import { buttonVariants } from "../ui/button";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { Message, loggedInUserData, userData } from "@/app/data";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import ExpandableTextarea from "./expandable-textarea";
import websocketService from "@/utils/websocketService";

interface ChatBottombarProps {
    sendMessage: (newMessage: Message) => void;
    isMobile: boolean;
}

export default function ChatBottombar({
    sendMessage,
    isMobile,
}: ChatBottombarProps) {
    const [message, setMessage] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [isConnected, setIsConnected] = useState(false);
    const messageIdCounterRef = useRef(Math.max(
        ...userData[0].messages.map(msg => msg.id),
        0
    ) + 1);

    useEffect(() => {
        const connectWebSocket = async () => {
            const connected = await websocketService.connect();
            setIsConnected(connected);
        };

        const handleWebSocketMessage = (data: any, messageType: 'response' | 'status' | 'error') => {
            if (messageType === 'response') {
                sendResponseMessage(data);
                setIsLoading(false);
            } else if (messageType === 'error') {
                console.error('WebSocket error:', data);
                setIsLoading(false);
            }
        };

        websocketService.addMessageHandler(handleWebSocketMessage);
        connectWebSocket();

        return () => {
            websocketService.removeMessageHandler(handleWebSocketMessage);
            websocketService.close();
        };
    }, []);

    const getNextMessageId = () => {
        const nextId = messageIdCounterRef.current;
        messageIdCounterRef.current += 1;
        return nextId;
    };

    const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setMessage(event.target.value);
    };

    const handleSend = async () => {
        if (message.trim() && isConnected) {
            const trimmedMessage = message.trim();

            const newMessage: Message = {
                id: getNextMessageId(),
                name: loggedInUserData.name,
                avatar: loggedInUserData.avatar,
                message: trimmedMessage,
            };

            sendMessage(newMessage);
            setMessage("");

            if (inputRef.current) {
                inputRef.current.focus();
            }

            try {
                const sent = websocketService.sendMessage(trimmedMessage);
                if (sent) {
                    setIsLoading(true);
                }
            } catch (error) {
                console.error("Error sending message:", error);
                setIsLoading(false);
            }
        }
    };

    function sendResponseMessage(response: string) {
        const responseMessage: Message = {
            id: getNextMessageId(),
            name: userData[0].name,
            avatar: userData[0].avatar,
            message: response,
        };
        userData[0].messages.push(responseMessage);
        sendMessage(responseMessage);
    }

    const handleKeyPress = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSend();
        }

        if (event.key === "Enter" && event.shiftKey) {
            event.preventDefault();
            setMessage((prev) => prev + "\n");
        }
    };

    return (
        <div className="pl-6 pr-8 py-2 flex justify-between w-full items-center gap-2 border border-gray-200 rounded-lg">
            <div className="flex">
                <Popover>
                    <PopoverTrigger asChild>
                        <Link
                            href="#"
                            className={cn(
                                buttonVariants({ variant: "ghost", size: "icon" }),
                                "h-9 w-9",
                                "dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-white"
                            )}
                        >
                        </Link>
                    </PopoverTrigger>
                    <PopoverContent
                        side="top"
                        className="w-full p-2">
                        {message.trim() || isMobile ? (
                            <div className="flex gap-2">
                                <Link
                                    href="#"
                                    className={cn(
                                        buttonVariants({ variant: "ghost", size: "icon" }),
                                        "h-9 w-9",
                                        "dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-white"
                                    )}
                                >
                                    <Mic size={20} className="text-muted-foreground" />
                                </Link>
                            </div>
                        ) : (
                            <Link
                                href="#"
                                className={cn(
                                    buttonVariants({ variant: "ghost", size: "icon" }),
                                    "h-9 w-9",
                                    "dark:bg-muted dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-white"
                                )}
                            >
                                <Mic size={20} className="text-muted-foreground" />
                            </Link>
                        )}
                    </PopoverContent>
                </Popover>
            </div>

            <AnimatePresence initial={false}>
                <motion.div
                    key="input"
                    className="w-full relative"
                    layout
                    initial={{ opacity: 0, scale: 1 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1 }}
                    transition={{
                        opacity: { duration: 0.05 },
                        layout: {
                            type: "spring",
                            bounce: 0.15,
                        },
                    }}
                >
                    <ExpandableTextarea
                        value={message}
                        onChange={handleInputChange}
                        onSend={handleSend}
                        onKeyPress={handleKeyPress}
                        placeholder="Type a message..."
                        isLoading={isLoading}
                    />
                </motion.div>
            </AnimatePresence>
        </div>
    );
}