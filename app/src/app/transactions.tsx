import { TransactionsScreen } from '@/components/transactions-screen';
import { blockscoutTransactionActivityProvider } from '@/wallet/transaction-activity-blockscout';

export default function TransactionsRoute() {
  return <TransactionsScreen provider={blockscoutTransactionActivityProvider} />;
}
