import { createContext, useContext } from 'react';
import type { Locale } from './api';

const tr = {
  'nav.dashboard': 'Özet',
  'nav.transactions': 'İşlemler',
  'nav.accounts': 'Hesaplar',
  'nav.categories': 'Kategoriler',
  'nav.settings': 'Ayarlar',
  'nav.lock': 'Kilitle',

  'lock.setupTitle': 'Hoş geldin',
  'lock.setupIntro': 'Verilerin bu bilgisayarda, ana şifrenle şifrelenmiş olarak saklanacak. Şifreyi unutursan veriler kurtarılamaz.',
  'lock.unlockTitle': 'Kilidi aç',
  'lock.password': 'Ana şifre',
  'lock.passwordRepeat': 'Ana şifre (tekrar)',
  'lock.workspaceName': 'Bütçe adı',
  'lock.create': 'Oluştur',
  'lock.unlock': 'Aç',
  'lock.mismatch': 'Şifreler aynı değil.',
  'lock.tooShort': 'Şifre en az 8 karakter olmalı.',
  'lock.wrong': 'Şifre yanlış.',

  'common.save': 'Kaydet',
  'common.cancel': 'Vazgeç',
  'common.delete': 'Sil',
  'common.edit': 'Düzenle',
  'common.add': 'Ekle',
  'common.name': 'Ad',
  'common.currency': 'Para birimi',
  'common.archived': 'Arşivlendi',
  'common.archive': 'Arşivle',
  'common.unarchive': 'Arşivden çıkar',
  'common.all': 'Tümü',
  'common.none': 'Yok',
  'common.search': 'Ara',
  'common.confirmDelete': 'Silmek istediğine emin misin?',
  'common.empty': 'Henüz kayıt yok.',
  'common.error': 'Bir hata oluştu.',
  'common.inUse': 'Kullanımda olduğu için silinemez, arşivleyebilirsin.',

  'kind.income': 'Gelir',
  'kind.expense': 'Gider',
  'kind.transfer': 'Transfer',

  'accountType.bank': 'Banka',
  'accountType.cash': 'Nakit',
  'accountType.credit_card': 'Kredi kartı',
  'accountType.savings': 'Birikim',
  'accountType.other': 'Diğer',

  'dashboard.income': 'Gelir',
  'dashboard.expense': 'Gider',
  'dashboard.net': 'Net',
  'dashboard.accounts': 'Hesap bakiyeleri',
  'dashboard.topExpenses': 'En çok harcanan kategoriler',
  'dashboard.recent': 'Son işlemler',
  'dashboard.noAccounts': 'Başlamak için bir hesap ekle.',
  'dashboard.uncategorized': 'Kategorisiz',

  'tx.add': 'İşlem ekle',
  'tx.edit': 'İşlemi düzenle',
  'tx.date': 'Tarih',
  'tx.amount': 'Tutar',
  'tx.account': 'Hesap',
  'tx.fromAccount': 'Gönderen hesap',
  'tx.toAccount': 'Alan hesap',
  'tx.toAmount': 'Alan hesaba geçen tutar',
  'tx.category': 'Kategori',
  'tx.note': 'Not',
  'tx.invalidAmount': 'Geçerli bir tutar gir.',
  'tx.needAccount': 'Önce bir hesap eklemelisin.',

  'account.add': 'Hesap ekle',
  'account.edit': 'Hesabı düzenle',
  'account.type': 'Tür',
  'account.openingBalance': 'Açılış bakiyesi',
  'account.balance': 'Bakiye',

  'category.add': 'Kategori ekle',
  'category.edit': 'Kategoriyi düzenle',
  'category.kind': 'Tür',
  'category.color': 'Renk',

  'settings.general': 'Genel',
  'settings.workspaceName': 'Bütçe adı',
  'settings.locale': 'Dil',
  'settings.baseCurrency': 'Ana para birimi',
  'settings.monthStartDay': 'Ay başlangıç günü',
  'settings.monthStartDayHelp': 'Bütçe dönemin ayın kaçında başlıyor (örn. maaş günü).',
  'settings.budgetWarnPercent': 'Bütçe uyarı eşiği (%)',
  'settings.theme': 'Tema',
  'settings.theme.system': 'Sistem',
  'settings.theme.light': 'Açık',
  'settings.theme.dark': 'Koyu',
  'settings.saved': 'Kaydedildi.',
  'settings.security': 'Güvenlik',
  'settings.currentPassword': 'Mevcut şifre',
  'settings.newPassword': 'Yeni şifre',
  'settings.changePassword': 'Şifreyi değiştir',
  'settings.passwordChanged': 'Şifre değiştirildi.',
};

type Key = keyof typeof tr;

const en: Record<Key, string> = {
  'nav.dashboard': 'Overview',
  'nav.transactions': 'Transactions',
  'nav.accounts': 'Accounts',
  'nav.categories': 'Categories',
  'nav.settings': 'Settings',
  'nav.lock': 'Lock',

  'lock.setupTitle': 'Welcome',
  'lock.setupIntro': 'Your data is stored on this computer, encrypted with your master password. If you forget it, the data cannot be recovered.',
  'lock.unlockTitle': 'Unlock',
  'lock.password': 'Master password',
  'lock.passwordRepeat': 'Master password (again)',
  'lock.workspaceName': 'Budget name',
  'lock.create': 'Create',
  'lock.unlock': 'Unlock',
  'lock.mismatch': 'Passwords do not match.',
  'lock.tooShort': 'Password must be at least 8 characters.',
  'lock.wrong': 'Wrong password.',

  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.name': 'Name',
  'common.currency': 'Currency',
  'common.archived': 'Archived',
  'common.archive': 'Archive',
  'common.unarchive': 'Unarchive',
  'common.all': 'All',
  'common.none': 'None',
  'common.search': 'Search',
  'common.confirmDelete': 'Are you sure you want to delete this?',
  'common.empty': 'Nothing here yet.',
  'common.error': 'Something went wrong.',
  'common.inUse': 'It is in use and cannot be deleted; archive it instead.',

  'kind.income': 'Income',
  'kind.expense': 'Expense',
  'kind.transfer': 'Transfer',

  'accountType.bank': 'Bank',
  'accountType.cash': 'Cash',
  'accountType.credit_card': 'Credit card',
  'accountType.savings': 'Savings',
  'accountType.other': 'Other',

  'dashboard.income': 'Income',
  'dashboard.expense': 'Expense',
  'dashboard.net': 'Net',
  'dashboard.accounts': 'Account balances',
  'dashboard.topExpenses': 'Top spending categories',
  'dashboard.recent': 'Recent transactions',
  'dashboard.noAccounts': 'Add an account to get started.',
  'dashboard.uncategorized': 'Uncategorized',

  'tx.add': 'Add transaction',
  'tx.edit': 'Edit transaction',
  'tx.date': 'Date',
  'tx.amount': 'Amount',
  'tx.account': 'Account',
  'tx.fromAccount': 'From account',
  'tx.toAccount': 'To account',
  'tx.toAmount': 'Amount received',
  'tx.category': 'Category',
  'tx.note': 'Note',
  'tx.invalidAmount': 'Enter a valid amount.',
  'tx.needAccount': 'Add an account first.',

  'account.add': 'Add account',
  'account.edit': 'Edit account',
  'account.type': 'Type',
  'account.openingBalance': 'Opening balance',
  'account.balance': 'Balance',

  'category.add': 'Add category',
  'category.edit': 'Edit category',
  'category.kind': 'Type',
  'category.color': 'Color',

  'settings.general': 'General',
  'settings.workspaceName': 'Budget name',
  'settings.locale': 'Language',
  'settings.baseCurrency': 'Base currency',
  'settings.monthStartDay': 'Month start day',
  'settings.monthStartDayHelp': 'Day of the month your budget period starts (e.g. payday).',
  'settings.budgetWarnPercent': 'Budget warning threshold (%)',
  'settings.theme': 'Theme',
  'settings.theme.system': 'System',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.saved': 'Saved.',
  'settings.security': 'Security',
  'settings.currentPassword': 'Current password',
  'settings.newPassword': 'New password',
  'settings.changePassword': 'Change password',
  'settings.passwordChanged': 'Password changed.',
};

const dictionaries: Record<Locale, Record<Key, string>> = { tr, en };

export type T = (key: Key) => string;

export const makeT =
  (locale: Locale): T =>
  (key) =>
    dictionaries[locale][key] ?? key;

export const LocaleContext = createContext<Locale>('tr');

export function useT() {
  const locale = useContext(LocaleContext);
  return { t: makeT(locale), locale };
}

export function monthLabel(year: number, month: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1),
  );
}
