import { AttendanceResolutionControls } from '../../../components/attendance-resolution-controls';
export default async function AttendanceResolutionPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <main className="publicShell"><AttendanceResolutionControls viewingId={id}/></main>;}
