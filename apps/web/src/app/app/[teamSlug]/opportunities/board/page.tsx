import { renderBoardPage } from "../../_board-page";
const OpportunityBoardPage = (properties: { params: Promise<{ teamSlug: string }> }) => renderBoardPage("opportunities", properties);
export default OpportunityBoardPage;
