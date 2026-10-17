import { useData } from '../lib/data';
import { useT } from '../lib/i18n';
import { decimalsOf, formatMoney } from '../lib/money';
import { cx } from './ui';

export function useMoney() {
  const { currencies } = useData();
  const { locale } = useT();
  return (minor: number, currency: string) => formatMoney(minor, currency, decimalsOf(currencies, currency), locale);
}

export function Money({ amount, currency, signed, className }: { amount: number; currency: string; signed?: boolean; className?: string }) {
  const format = useMoney();
  return (
    <span
      className={cx(
        'tabular-nums',
        signed && amount > 0 && 'text-emerald-700 dark:text-emerald-400',
        signed && amount < 0 && 'text-red-600 dark:text-red-400',
        className,
      )}
    >
      {signed && amount > 0 ? '+' : ''}
      {format(amount, currency)}
    </span>
  );
}
