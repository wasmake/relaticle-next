import type { ReactNode } from "react";
import { Fragment } from "react";

const safeLink = (url: string) =>
    url.startsWith("/")
    || url.startsWith("#")
    || /^https?:\/\//i.test(url)
    || /^mailto:/i.test(url);

const safeImage = (url: string) => url.startsWith("/help-assets/");

const inlinePattern = /(!?\[[^\]]*]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;

const inline = (text: string): ReactNode[] =>
    text.split(inlinePattern).filter(Boolean).map((part, index) => {
        const key = `${index}-${part}`;
        const image = /^!\[([^\]]*)]\(([^)]+)\)$/.exec(part);
        if (image) {
            const alt = image[1] ?? "";
            const source = image[2] ?? "";
            return safeImage(source)
                // Historical article images do not carry dimensions for next/image.
                // eslint-disable-next-line @next/next/no-img-element
                ? <img alt={alt} decoding="async" key={key} loading="lazy" src={source} />
                : <Fragment key={key}>{alt}</Fragment>;
        }
        const link = /^\[([^\]]*)]\(([^)]+)\)$/.exec(part);
        if (link) {
            const label = link[1] ?? "";
            const href = link[2] ?? "";
            return safeLink(href)
                ? <a href={href} key={key}>{label}</a>
                : <Fragment key={key}>{label}</Fragment>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
            return <code key={key}>{part.slice(1, -1)}</code>;
        }
        if ((part.startsWith("**") && part.endsWith("**"))
            || (part.startsWith("__") && part.endsWith("__"))) {
            return <strong key={key}>{part.slice(2, -2)}</strong>;
        }
        if ((part.startsWith("*") && part.endsWith("*"))
            || (part.startsWith("_") && part.endsWith("_"))) {
            return <em key={key}>{part.slice(1, -1)}</em>;
        }
        return <Fragment key={key}>{part}</Fragment>;
    });

const headingId = (heading: string, used: Map<string, number>) => {
    const base = heading
        .toLowerCase()
        .replace(/[`*_]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
};

const tableRow = (line: string) =>
    line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

export const Markdown = ({ source }: { source: string }) => {
    const lines = source.replace(/\r/g, "").split("\n");
    const nodes: ReactNode[] = [];
    const usedHeadings = new Map<string, number>();
    let index = 0;

    while (index < lines.length) {
        const line = lines[index] ?? "";
        if (!line.trim()) {
            index++;
            continue;
        }
        if (line.startsWith("```")) {
            const language = line.slice(3).trim();
            const code: string[] = [];
            index++;
            while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
                code.push(lines[index] ?? "");
                index++;
            }
            index++;
            nodes.push(<pre key={`code-${index}`}><code className={language ? `language-${language}` : undefined}>{code.join("\n")}</code></pre>);
            continue;
        }
        const heading = /^(#{2,4})\s+(.+)$/.exec(line);
        if (heading) {
            const level = heading[1]?.length ?? 2;
            const text = heading[2] ?? "";
            const id = headingId(text, usedHeadings);
            if (level === 2) nodes.push(<h2 id={id} key={`heading-${index}`}>{inline(text)}</h2>);
            if (level === 3) nodes.push(<h3 id={id} key={`heading-${index}`}>{inline(text)}</h3>);
            if (level === 4) nodes.push(<h4 id={id} key={`heading-${index}`}>{inline(text)}</h4>);
            index++;
            continue;
        }
        if (/^---+$/.test(line.trim())) {
            nodes.push(<hr key={`rule-${index}`} />);
            index++;
            continue;
        }
        if (line.includes("|") && /^\s*\|?\s*:?-+/.test(lines[index + 1] ?? "")) {
            const headers = tableRow(line);
            index += 2;
            const rows: string[][] = [];
            while (index < lines.length && (lines[index] ?? "").includes("|")) {
                rows.push(tableRow(lines[index] ?? ""));
                index++;
            }
            nodes.push(
                <div className="table-scroll" key={`table-${index}`}><table>
                    <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr></thead>
                    <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}</tr>)}</tbody>
                </table></div>,
            );
            continue;
        }
        const list = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(line);
        if (list) {
            const ordered = /\d+\./.test(list[2] ?? "");
            const items: string[] = [];
            while (index < lines.length) {
                const item = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(lines[index] ?? "");
                if (!item || /\d+\./.test(item[2] ?? "") !== ordered) break;
                let text = item[3] ?? "";
                index++;
                while (index < lines.length && /^\s{2,}\S/.test(lines[index] ?? "")) {
                    text += ` ${(lines[index] ?? "").trim()}`;
                    index++;
                }
                items.push(text);
            }
            const children = items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>);
            nodes.push(ordered
                ? <ol key={`list-${index}`}>{children}</ol>
                : <ul key={`list-${index}`}>{children}</ul>);
            continue;
        }
        if (line.startsWith("> ")) {
            const quote: string[] = [];
            while (index < lines.length && (lines[index] ?? "").startsWith("> ")) {
                quote.push((lines[index] ?? "").slice(2));
                index++;
            }
            nodes.push(<blockquote key={`quote-${index}`}>{inline(quote.join(" "))}</blockquote>);
            continue;
        }

        const paragraph = [line.trim()];
        index++;
        while (index < lines.length && (lines[index] ?? "").trim()
            && !/^(#{2,4})\s|^```|^---+$|^(\s*)([-*]|\d+\.)\s+|^> /.test(lines[index] ?? "")) {
            if ((lines[index] ?? "").includes("|") && /^\s*\|?\s*:?-+/.test(lines[index + 1] ?? "")) break;
            paragraph.push((lines[index] ?? "").trim());
            index++;
        }
        nodes.push(<p key={`paragraph-${index}`}>{inline(paragraph.join(" "))}</p>);
    }

    return <>{nodes}</>;
};

export const markdownToPlainText = (source: string) => source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/[*_#>`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const markdownSections = (source: string) => {
    const sections: Array<{ anchor: string; content: string; section: string }> = [];
    const matches = [...source.matchAll(/^##\s+(.+)$/gm)];
    const used = new Map<string, number>();
    const firstHeading = matches[0];
    sections.push({
        anchor: "",
        content: markdownToPlainText(source.slice(0, firstHeading?.index ?? source.length)),
        section: "",
    });
    matches.forEach((match, index) => {
        const section = (match[1] ?? "").trim();
        const start = (match.index ?? 0) + match[0].length;
        const end = matches[index + 1]?.index ?? source.length;
        sections.push({
            anchor: headingId(section, used),
            content: markdownToPlainText(source.slice(start, end)),
            section,
        });
    });
    return sections.filter((section) => section.content);
};
