import { Metadata } from "next";
import AdminLoginClient from "@/components/admin-login-client";

export const metadata: Metadata = {
    title: "Photographer Login",
};

export default function AdminLoginPage() {
    return <AdminLoginClient />;
}
