import { authorityRiskProxy } from '../../../lib/authority-risk-proxy';
export async function POST(request: Request) { return authorityRiskProxy('',request); }
