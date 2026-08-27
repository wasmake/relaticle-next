import type { SVGProps } from "react";

const paths = {
    assistant: <><path d="M9 3h6M12 3v3M7 7h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><path d="M8 12h.01M16 12h.01M9 15h6" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    building: <><path d="M4 21h16M6 21V7l6-3v17M18 21V11l-6-2M9 9h.01M9 13h.01M9 17h.01M15 13h.01M15 17h.01" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.5 7.5 4 7.5-4M12 12v9" /></>,
    dashboard: <><path d="M3 12 12 4l9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
    dots: <><path d="M12 5h.01M12 12h.01M12 19h.01" /></>,
    filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />,
    note: <><path d="M6 3h9l4 4v14H6V3Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    task: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    trophy: <><path d="M8 4h8v4a4 4 0 0 1-8 0V4ZM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 12v5M8 21h8M9 17h6" /></>,
} as const;

export type CrmIconName = keyof typeof paths;

export const CrmIcon = ({ name, ...properties }: SVGProps<SVGSVGElement> & { name: CrmIconName }) => (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...properties}>
        {paths[name]}
    </svg>
);
