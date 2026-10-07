import { blockProxy } from '../../../../../../lib/block-bff';
export async function POST(request:Request,context:{params:Promise<{blockId:string}>}) {
  const {blockId}=await context.params;return blockProxy(request,`blocks/${encodeURIComponent(blockId)}/unblock`,true);
}
