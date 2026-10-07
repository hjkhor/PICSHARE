import { Metadata } from "next";
import AdminDashboardClient from "@/components/admin-dashboard-client";

export const metadata: Metadata = {
    title: "Photographer Dashboard",
};

export default function AdminDashboardPage() {
    return <AdminDashboardClient />;
}
