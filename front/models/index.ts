export interface User {
  userId: number;
  subOrgId: string;
  email: string;
}

export interface WalletWithBalance {
  walletId: string;
  ethAddress: string;
  solAddress: string;
  solBalance: string;
  wrenAddress?: string;
  wrenBalance?: string;
}
