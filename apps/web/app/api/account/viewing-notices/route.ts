import { viewingProxy } from '@/lib/viewing-bff';
export async function GET(request:Request) {return viewingProxy(request,'viewing-notices');}
