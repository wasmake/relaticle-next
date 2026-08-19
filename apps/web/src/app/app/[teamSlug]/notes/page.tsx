import { renderCrmResourcePage, type CrmRouteProperties } from "../_resource-page";

const NotesPage = (properties: CrmRouteProperties) =>
    renderCrmResourcePage("notes", properties);

export default NotesPage;
