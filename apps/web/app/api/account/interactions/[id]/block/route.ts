import { blockProxy } from '../../../../../../lib/block-bff';
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;return blockProxy(request,`interactions/${encodeURIComponent(id)}/block`,true);
}
