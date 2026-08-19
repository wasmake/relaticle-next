import { renderCrmResourcePage, type CrmRouteProperties } from "../_resource-page";

const OpportunitiesPage = (properties: CrmRouteProperties) =>
    renderCrmResourcePage("opportunities", properties);

export default OpportunitiesPage;
