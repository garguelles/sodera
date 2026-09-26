import { TransactionsScreen } from '@/components/transactions-screen';
import { pendingSends } from '@/wallet/pending-sends';

export default function TransactionsRoute() {
  return <TransactionsScreen provider={pendingSends.provider} />;
}
