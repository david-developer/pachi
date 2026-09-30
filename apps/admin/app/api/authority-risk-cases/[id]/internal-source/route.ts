import { authorityRiskProxy } from '../../../../../lib/authority-risk-proxy';

export async function GET(request: Request, context: { params: Promise<{id:string}> }) {
  const {id}=await context.params;
  return authorityRiskProxy(`/${encodeURIComponent(id)}/internal-source`,request);
}
