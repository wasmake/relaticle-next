import { renderCrmTrashPage } from "../../_trash-page";
const PeopleTrashPage = (properties: { params: Promise<{ teamSlug: string }> }) => renderCrmTrashPage("people", properties);
export default PeopleTrashPage;
