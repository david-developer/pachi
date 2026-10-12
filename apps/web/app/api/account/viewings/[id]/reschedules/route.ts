import { viewingProxy } from '@/lib/viewing-bff';
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {const {id}=await context.params;return viewingProxy(request,`viewings/${encodeURIComponent(id)}/reschedules`);}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {const {id}=await context.params;return viewingProxy(request,`viewings/${encodeURIComponent(id)}/reschedules`,true);}
