import Link from 'next/link';
import { ViewingList } from '../components/viewing-controls';

export default function ViewingsPage() {
  return <main className="publicShell">
    <nav aria-label="Marketplace"><Link href="/conversations">Your conversations</Link> · <Link href="/listings">Browse listings</Link></nav>
    <h1>Your viewings</h1>
    <p>Track your requests and respond to incoming appointments.</p>
    <ViewingList />
  </main>;
}
