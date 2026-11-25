import type { Metadata } from "next";
import { AccountManager } from "@/components/admin/account-manager";

export const metadata: Metadata = { title: "Comptes — Administration" };
export const dynamic = "force-dynamic";

export default function AdminAccountsPage() {
  return <AccountManager />;
}
