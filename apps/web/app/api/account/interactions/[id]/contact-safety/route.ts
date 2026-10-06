import { blockProxy } from '../../../../../../lib/block-bff';
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  const {id}=await context.params;return blockProxy(request,`interactions/${encodeURIComponent(id)}/contact-safety`,false);
}
