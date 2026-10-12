import { viewingProxy } from '@/lib/viewing-bff';
export async function POST(request:Request,context:{params:Promise<{id:string;proposalId:string;command:string}>}) {
  const {id,proposalId,command}=await context.params;
  if(!['accept','reject','withdraw'].includes(command))return Response.json({error:'not_found'},{status:404,headers:{'cache-control':'private, no-store'}});
  return viewingProxy(request,`viewings/${encodeURIComponent(id)}/reschedules/${encodeURIComponent(proposalId)}/${command}`,true);
}
