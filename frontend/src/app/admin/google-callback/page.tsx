"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Cookies from "js-cookie";

export default function GoogleCallbackPage() {
    const router = useRouter();
    const [error, setError] = useState("");
    const started = useRef(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const ticket = new URLSearchParams(window.location.hash.slice(1)).get("ticket");
        window.history.replaceState(null, "", "/admin/google-callback");
        if (!ticket) {
            setError("Google sign-in could not be completed. Please try again.");
            return;
        }

        const api = process.env.NEXT_PUBLIC_API_URL || "/api";
        fetch(`${api}/auth/google/session`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ticket}),
        }).then(async response => {
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Google sign-in expired");
            Cookies.set("admin_token", data.access_token, {
                expires: 1, sameSite: "strict", secure: window.location.protocol === "https:"
            });
            router.replace("/admin/dashboard");
        }).catch(err => setError(err instanceof Error ? err.message : "Google sign-in failed"));
    }, [router]);

    return <main className="auth-page" style={{display: "block", minHeight: "60vh"}}>
        <section className="auth-form-panel" style={{maxWidth: 520, margin: "60px auto"}}>
            <p className="eyebrow">[ PHOTOGRAPHER ACCESS ]</p>
            <h1>{error ? "SIGN-IN FAILED" : "SIGNING YOU IN"}<span>_</span></h1>
            <p className="auth-helper" style={{marginTop: 18}}>{error || "Finishing your Google sign-in..."}</p>
            {error && <Link href="/admin/login" className="auth-switch">BACK TO LOGIN →</Link>}
        </section>
    </main>;
}
