import { blockProxy } from '../../../../../../lib/block-bff';
export async function GET(request:Request,context:{params:Promise<{listingId:string}>}) {
  const {listingId}=await context.params;return blockProxy(request,`listings/${encodeURIComponent(listingId)}/contact-safety`,false);
}
