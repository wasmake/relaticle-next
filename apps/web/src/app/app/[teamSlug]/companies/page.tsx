import { renderCrmResourcePage, type CrmRouteProperties } from "../_resource-page";

const CompaniesPage = (properties: CrmRouteProperties) =>
    renderCrmResourcePage("companies", properties);

export default CompaniesPage;
