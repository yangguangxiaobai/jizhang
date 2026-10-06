// Shared client-side JSON shapes for `/api/v1` responses.
// Display only: every figure is server-computed (cents / epoch ms untouched).
// Each response interface exists so UI files never `JSON.parse` into `any`
// and never pass anonymous object literals (ArkTS strict-mode compliance).

/** One `Select` option (`{ value }` literal factored out for ArkTS). */
export interface SelOpt {
  value: string;
}

/** "我的" home section entry (was an inline `{key,label}` literal). */
export interface MySection {
  key: string;
  label: string;
}

export interface CatNameItem {
  id: string;
  name: string;
  type: number;
}

export interface AccountNameItem {
  id: string;
  name: string;
}

export interface CatListResp {
  items: CatNameItem[];
}

export interface AccountListResp {
  items: AccountNameItem[];
}

export interface BalanceRowResp {
  accountId: string;
  balanceCents: number;
}

export interface BalanceListResp {
  items: BalanceRowResp[];
  totalBalanceCents: number;
}

export interface PendingIdResp {
  id: string;
}

export interface PendingCountResp {
  total: number;
  items: PendingIdResp[];
}

export interface TagCountResp {
  name: string;
  count: number;
}

export interface TagListResp {
  items: Array<string | TagCountResp>;
}

export interface UsageResp {
  transactions?: number;
  count?: number;
  total?: number;
}
