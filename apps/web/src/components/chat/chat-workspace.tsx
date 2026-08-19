"use client";

import { useEffect, useRef, useState } from "react";

import type { ChatConversation, ChatMessage, ChatReference, PendingActionView, StreamEvent } from "@/server/chat/types";

import styles from "./chat.module.css";

type Model = Readonly<{ id: string; label: string }>;
type Properties = Readonly<{ teamId: string; initialConversations: readonly ChatConversation[]; models: readonly Model[] }>;
type VisibleMessage = ChatMessage | Readonly<{ id: string; role: "assistant" | "user"; content: string; pendingActions: readonly PendingActionView[] }>;

const requestHeaders = (teamId: string, json = false): HeadersInit => ({ "x-team-id": teamId, ...(json ? { "content-type": "application/json" } : {}) });
const dateLabel = (value: Date | string | null): string => value === null ? "" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));

export const ChatWorkspace = ({ teamId, initialConversations, models }: Properties) => {
    const [conversations, setConversations] = useState<readonly ChatConversation[]>(initialConversations);
    const [activeId, setActiveId] = useState<string | null>(initialConversations[0]?.id ?? null);
    const [messages, setMessages] = useState<readonly VisibleMessage[]>([]);
    const [prompt, setPrompt] = useState("");
    const [model, setModel] = useState("auto");
    const [search, setSearch] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [mentions, setMentions] = useState<readonly ChatReference[]>([]);
    const [mentionResults, setMentionResults] = useState<readonly ChatReference[]>([]);
    const scroll = useRef<HTMLDivElement>(null);
    const optimisticSequence = useRef(0);

    useEffect(() => {
        if (activeId === null) return;
        const controller = new AbortController();
        void fetch(`/chat/conversations/${activeId}`, { headers: requestHeaders(teamId), signal: controller.signal })
            .then(async (response) => response.ok ? response.json() as Promise<{ messages: ChatMessage[] }> : Promise.reject(new Error("Conversation could not be loaded.")))
            .then((data) => setMessages(data.messages))
            .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Conversation could not be loaded."); });
        return () => controller.abort();
    }, [activeId, teamId]);

    useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [messages]);

    useEffect(() => {
        const match = /(?:^|\s)@([^\s@]{2,})$/u.exec(prompt);
        if (match?.[1] === undefined) return;
        const controller = new AbortController();
        const query = match[1];
        if (query === undefined) return;
        const timeout = setTimeout(() => void fetch(`/chat/mentions?q=${encodeURIComponent(query)}`, { headers: requestHeaders(teamId), signal: controller.signal }).then((response) => response.json() as Promise<{ mentions?: ChatReference[] }>).then((data) => setMentionResults(data.mentions ?? [])).catch(() => undefined), 180);
        return () => { clearTimeout(timeout); controller.abort(); };
    }, [prompt, teamId]);

    const refreshConversations = async (query = search) => {
        const response = await fetch(`/chat/conversations?q=${encodeURIComponent(query)}`, { headers: requestHeaders(teamId) });
        if (response.ok) setConversations(((await response.json()) as { conversations: ChatConversation[] }).conversations);
    };

    const selectMention = (reference: ChatReference) => {
        setPrompt((value) => value.replace(/@[^\s@]*$/u, `@${reference.label} `));
        setMentions((value) => [...value.filter((item) => item.id !== reference.id || item.type !== reference.type), reference]);
        setMentionResults([]);
    };

    const send = async () => {
        const content = prompt.trim();
        if (content === "" || busy) return;
        setBusy(true); setError(""); setPrompt("");
        let conversationId = activeId;
        try {
            if (conversationId === null) {
                const created = await fetch("/chat/conversations", { method: "POST", headers: requestHeaders(teamId, true), body: JSON.stringify({ message: content }) });
                if (!created.ok) throw new Error("Conversation could not be created.");
                const data = await created.json() as { conversation: ChatConversation };
                conversationId = data.conversation.id;
                setConversations((items) => [data.conversation, ...items]);
                setActiveId(conversationId);
            }
            optimisticSequence.current += 1;
            const optimisticId = `local-${optimisticSequence.current}`;
            setMessages((items) => [...items, { id: optimisticId, role: "user", content, pendingActions: [] }, { id: `${optimisticId}-assistant`, role: "assistant", content: "", pendingActions: [] }]);
            const response = await fetch(`/chat/conversations/${conversationId}/messages`, { method: "POST", headers: requestHeaders(teamId, true), body: JSON.stringify({ message: content, model, mentions: mentions.map(({ type, id }) => ({ type, id })) }) });
            if (!response.ok || response.body === null) throw new Error("The assistant could not start.");
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                buffer += value ?? "";
                const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
                for (const line of lines) if (line.trim() !== "") applyEvent(JSON.parse(line) as StreamEvent, optimisticId);
                if (done) break;
            }
            setMentions([]);
            await refreshConversations("");
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The assistant encountered an error.");
        } finally { setBusy(false); }
    };

    const applyEvent = (event: StreamEvent, optimisticId: string) => {
        if (event.type === "text_delta") setMessages((items) => items.map((item) => item.id === `${optimisticId}-assistant` ? { ...item, content: item.content + event.delta } : item));
        else if (event.type === "proposal") setMessages((items) => items.map((item) => item.id === `${optimisticId}-assistant` ? { ...item, pendingActions: [...item.pendingActions, event.action] } : item));
        else if (event.type === "done") setMessages((items) => items.map((item) => item.id === `${optimisticId}-assistant` ? { ...event.message, pendingActions: item.pendingActions.length > 0 ? item.pendingActions : event.message.pendingActions } : item));
        else if (event.type === "error" || event.type === "cancelled") setError(event.message);
        else if (event.type === "title") setConversations((items) => items.map((item) => item.id === activeId ? { ...item, title: event.title } : item));
    };

    const resolveAction = async (action: PendingActionView, decision: "approve" | "reject") => {
        const response = await fetch(`/chat/actions/${action.id}/${decision}`, { method: "POST", headers: requestHeaders(teamId, true) });
        if (!response.ok) { setError("That proposal is no longer available."); return; }
        const updated = ((await response.json()) as { action: PendingActionView }).action;
        setMessages((items) => items.map((message) => ({ ...message, pendingActions: message.pendingActions.map((item) => item.id === action.id ? updated : item) })));
    };

    const removeConversation = async (conversation: ChatConversation) => {
        if (!window.confirm(`Delete “${conversation.title}”?`)) return;
        const response = await fetch(`/chat/conversations/${conversation.id}`, { method: "DELETE", headers: requestHeaders(teamId, true) });
        if (response.ok) { setConversations((items) => items.filter((item) => item.id !== conversation.id)); if (activeId === conversation.id) setActiveId(null); }
    };

    const renameConversation = async (conversation: ChatConversation) => {
        const title = window.prompt("Conversation title", conversation.title)?.trim();
        if (!title) return;
        const response = await fetch(`/chat/conversations/${conversation.id}`, { method: "PATCH", headers: requestHeaders(teamId, true), body: JSON.stringify({ title }) });
        if (response.ok) setConversations((items) => items.map((item) => item.id === conversation.id ? { ...item, title } : item));
    };

    const stop = async () => { if (activeId !== null) await fetch(`/chat/conversations/${activeId}/cancel`, { method: "POST", headers: requestHeaders(teamId, true) }); };
    const feedback = async (messageId: string, rating: "up" | "down") => { await fetch(`/chat/messages/${messageId}/feedback`, { method: "POST", headers: requestHeaders(teamId, true), body: JSON.stringify({ rating }) }); };

    return <div className={styles.shell}>
        <aside className={styles.threads}>
            <div className={styles.threadHeader}><div><span>Workspace intelligence</span><h1>Assistant</h1></div><button type="button" onClick={() => { setActiveId(null); setMessages([]); }} aria-label="New conversation">+</button></div>
            <label className={styles.search}><span>Search conversations</span><input value={search} onChange={(event) => { setSearch(event.target.value); void refreshConversations(event.target.value); }} placeholder="Search" /></label>
            <div className={styles.threadList}>{conversations.map((conversation) => <div className={styles.thread} data-active={activeId === conversation.id} key={conversation.id}>
                <button type="button" onClick={() => setActiveId(conversation.id)}><strong>{conversation.title}</strong><time>{dateLabel(conversation.updatedAt)}</time></button>
                <div><button type="button" onClick={() => void renameConversation(conversation)} aria-label="Rename">Edit</button><button type="button" onClick={() => void removeConversation(conversation)} aria-label="Delete">×</button></div>
            </div>)}</div>
        </aside>
        <section className={styles.chat}>
            <header><div><span>RELATICLE AI</span><strong>{activeId === null ? "A new conversation" : conversations.find((item) => item.id === activeId)?.title}</strong></div><select aria-label="AI model" value={model} onChange={(event) => setModel(event.target.value)}>{models.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></header>
            <div className={styles.messages} ref={scroll}>
                {messages.length === 0 && <div className={styles.empty}><p>Ask across your workspace</p><h2>Turn CRM context into<br />clear next moves.</h2><div><button onClick={() => setPrompt("Give me a summary of my CRM data")}>CRM overview</button><button onClick={() => setPrompt("Show my most recent companies")}>Recent companies</button><button onClick={() => setPrompt("List open tasks")}>Open tasks</button></div></div>}
                {messages.map((message) => <article key={message.id} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}><span>{message.role === "user" ? "You" : "Assistant"}</span><div className={styles.messageText}>{message.content}</div>
                    {message.pendingActions.map((action) => <div className={styles.proposal} key={action.id}><small>{action.operation} {action.entityType}</small><strong>{String(action.displayData.label ?? action.entityType)}</strong>{action.status === "pending" ? <div><button onClick={() => void resolveAction(action, "reject")}>Reject</button><button onClick={() => void resolveAction(action, "approve")}>Approve</button></div> : <em>{action.status}</em>}</div>)}
                    {message.role === "assistant" && !message.id.startsWith("local-") && <div className={styles.feedback}><button onClick={() => void feedback(message.id, "up")} aria-label="Helpful">Useful</button><button onClick={() => void feedback(message.id, "down")} aria-label="Not helpful">Needs work</button></div>}
                </article>)}
            </div>
            <footer className={styles.composer}>{mentions.length > 0 && <div className={styles.chips}>{mentions.map((item) => <button key={`${item.type}-${item.id}`} onClick={() => setMentions((values) => values.filter((value) => value !== item))}>@{item.label} ×</button>)}</div>}
                {mentionResults.length > 0 && <div className={styles.mentionMenu}>{mentionResults.map((item) => <button key={`${item.type}-${item.id}`} onClick={() => selectMention(item)}><strong>{item.label}</strong><span>{item.type}</span></button>)}</div>}
                <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); if (!/(?:^|\s)@([^\s@]{2,})$/u.test(event.target.value)) setMentionResults([]); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about your CRM, or propose a change…" rows={3} />
                <div><span>Use @ to reference a record</span>{busy ? <button type="button" onClick={() => void stop()}>Stop</button> : <button type="button" onClick={() => void send()} disabled={prompt.trim() === ""}>Send</button>}</div>{error !== "" && <p role="alert">{error}</p>}
            </footer>
        </section>
    </div>;
};
