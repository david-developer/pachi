import Link from 'next/link';
import { ViewingNoticeInbox } from '../../components/viewing-appointment-controls';
export default function ViewingNoticesPage(){return <main className="publicShell"><Link href="/viewings">Your viewings</Link><h1>Appointment notices</h1><ViewingNoticeInbox/></main>;}
