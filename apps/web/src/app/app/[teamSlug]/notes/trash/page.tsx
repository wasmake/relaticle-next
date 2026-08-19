import { renderCrmTrashPage } from "../../_trash-page";
const NoteTrashPage = (properties: { params: Promise<{ teamSlug: string }> }) => renderCrmTrashPage("notes", properties);
export default NoteTrashPage;
