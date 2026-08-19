import { renderCrmTrashPage } from "../../_trash-page";
const CompanyTrashPage = (properties: { params: Promise<{ teamSlug: string }> }) => renderCrmTrashPage("companies", properties);
export default CompanyTrashPage;
