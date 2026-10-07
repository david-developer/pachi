import { blockProxy } from '../../../../lib/block-bff';
export async function GET(request:Request) {return blockProxy(request,'blocks');}
