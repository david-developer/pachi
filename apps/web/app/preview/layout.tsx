import type { ReactNode } from 'react';
import './preview.css';
import { PreviewProvider } from './preview-context';
import { PreviewShell } from './preview-shell';

export const metadata = {
  title: 'Pachi | Housing in Cameroon - Design preview',
  description: 'A synthetic visual preview of housing discovery, property details and provider drafts in Cameroon.',
};

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return <PreviewProvider><PreviewShell>{children}</PreviewShell></PreviewProvider>;
}
