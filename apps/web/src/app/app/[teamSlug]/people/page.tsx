import { renderCrmResourcePage, type CrmRouteProperties } from "../_resource-page";

const PeoplePage = (properties: CrmRouteProperties) =>
    renderCrmResourcePage("people", properties);

export default PeoplePage;
