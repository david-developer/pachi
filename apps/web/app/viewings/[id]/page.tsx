import Link from 'next/link';
import { ViewingDetail } from '../../components/viewing-controls';

export default async function ViewingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="publicShell">
    <Link href="/viewings">← Your viewings</Link>
    <h1>Viewing appointment</h1>
    <ViewingDetail viewingId={id} />
  </main>;
}
