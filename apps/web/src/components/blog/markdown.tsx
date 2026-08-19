import type { ReactNode } from "react";

export const safeMarkdownUrl = (value: string): string | undefined => {
    const trimmed = value.trim();
    if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;

    try {
        const url = new URL(trimmed);
        return ["http:", "https:", "mailto:"].includes(url.protocol)
            ? trimmed
            : undefined;
    } catch {
        return undefined;
    }
};

const inline = (value: string, key: string): ReactNode[] => {
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^\s)]+\))/gu;
    const output: ReactNode[] = [];
    let cursor = 0;

    for (const match of value.matchAll(pattern)) {
        const index = match.index;
        if (index > cursor) output.push(value.slice(cursor, index));
        const token = match[0];

        if (token.startsWith("`")) {
            output.push(<code key={`${key}-${index}`}>{token.slice(1, -1)}</code>);
        } else if (token.startsWith("**")) {
            output.push(<strong key={`${key}-${index}`}>{token.slice(2, -2)}</strong>);
        } else if (token.startsWith("*")) {
            output.push(<em key={`${key}-${index}`}>{token.slice(1, -1)}</em>);
        } else {
            const parts = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);
            const href = parts?.[2] === undefined ? undefined : safeMarkdownUrl(parts[2]);
            output.push(
                href === undefined ? (
                    parts?.[1] ?? token
                ) : (
                    <a key={`${key}-${index}`} href={href}>
                        {parts?.[1]}
                    </a>
                ),
            );
        }
        cursor = index + token.length;
    }

    if (cursor < value.length) output.push(value.slice(cursor));
    return output;
};

export const Markdown = ({ children }: Readonly<{ children: string }>) => {
    const lines = children.replace(/\r\n?/gu, "\n").split("\n");
    const blocks: ReactNode[] = [];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (line.trim() === "") continue;

        if (line.startsWith("```")) {
            const language = line.slice(3).trim();
            const code: string[] = [];
            index += 1;
            while (index < lines.length && !lines[index]?.startsWith("```")) {
                code.push(lines[index] ?? "");
                index += 1;
            }
            blocks.push(
                <pre key={`code-${index}`}>
                    <code className={language === "" ? undefined : `language-${language}`}>
                        {code.join("\n")}
                    </code>
                </pre>,
            );
            continue;
        }

        const heading = /^(#{1,4})\s+(.+)$/u.exec(line);
        if (heading?.[1] !== undefined && heading[2] !== undefined) {
            const content = inline(heading[2], `heading-${index}`);
            const level = heading[1].length;
            if (level === 1) blocks.push(<h2 key={index}>{content}</h2>);
            if (level === 2) blocks.push(<h2 key={index}>{content}</h2>);
            if (level === 3) blocks.push(<h3 key={index}>{content}</h3>);
            if (level === 4) blocks.push(<h4 key={index}>{content}</h4>);
            continue;
        }

        if (/^[-*]\s+/u.test(line)) {
            const items: string[] = [];
            while (index < lines.length && /^[-*]\s+/u.test(lines[index] ?? "")) {
                items.push((lines[index] ?? "").replace(/^[-*]\s+/u, ""));
                index += 1;
            }
            index -= 1;
            blocks.push(
                <ul key={`list-${index}`}>
                    {items.map((item, itemIndex) => (
                        <li key={`${index}-${itemIndex}`}>{inline(item, `li-${index}-${itemIndex}`)}</li>
                    ))}
                </ul>,
            );
            continue;
        }

        if (line.startsWith("> ")) {
            blocks.push(<blockquote key={index}>{inline(line.slice(2), `quote-${index}`)}</blockquote>);
            continue;
        }

        const paragraph = [line];
        while (
            index + 1 < lines.length &&
            (lines[index + 1] ?? "").trim() !== "" &&
            !/^(#{1,4})\s|^```|^[-*]\s|^>\s/u.test(lines[index + 1] ?? "")
        ) {
            index += 1;
            paragraph.push(lines[index] ?? "");
        }
        blocks.push(<p key={`paragraph-${index}`}>{inline(paragraph.join(" "), `p-${index}`)}</p>);
    }

    return <>{blocks}</>;
};
