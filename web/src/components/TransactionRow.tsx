import type { Transaction } from '../lib/api';
import { useData } from '../lib/data';
import { useT } from '../lib/i18n';
import { formatDate } from '../lib/money';
import { Money } from './Money';
import { Dot } from './ui';

export function TransactionRow({ tx, onClick, accountFilter }: { tx: Transaction; onClick?: () => void; accountFilter?: string }) {
  const { t, locale } = useT();
  const { accounts, categories } = useData();
  const account = accounts.find((a) => a.id === tx.accountId);
  const toAccount = accounts.find((a) => a.id === tx.toAccountId);
  const category = categories.find((c) => c.id === tx.categoryId);

  // Viewed from the receiving account, a transfer is money in; with no account filter it is unsigned.
  const received = tx.kind === 'transfer' && accountFilter === tx.toAccountId;
  const amount = received ? (tx.toAmount ?? tx.amount) : tx.amount;
  const currency = (received ? toAccount?.currency : account?.currency) ?? '';
  const neutral = tx.kind === 'transfer' && !accountFilter;
  const signedAmount = neutral || received || tx.kind === 'income' ? amount : -amount;
  const title =
    tx.kind === 'transfer' ? `${account?.name ?? '?'} → ${toAccount?.name ?? '?'}` : (category?.name ?? t('dashboard.uncategorized'));

  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 sm:px-2">
        <Dot color={tx.kind === 'transfer' ? '#94a3b8' : (category?.color ?? '#94a3b8')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
            {formatDate(tx.date, locale)}
            {tx.kind !== 'transfer' && account ? ` · ${account.name}` : ''}
            {tx.note ? ` · ${tx.note}` : ''}
          </span>
        </span>
        <Money amount={signedAmount} currency={currency} signed={!neutral} className="text-sm font-semibold" />
      </button>
    </li>
  );
}
