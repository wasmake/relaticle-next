import { renderCrmTrashPage } from "../../_trash-page";
const OpportunityTrashPage = (properties: { params: Promise<{ teamSlug: string }> }) => renderCrmTrashPage("opportunities", properties);
export default OpportunityTrashPage;
