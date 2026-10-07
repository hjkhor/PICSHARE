"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowUpRight, Camera } from "lucide-react";

export default function AdminLoginClient() {
    const [register, setRegister] = useState(false);
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [name, setName] = useState("");
    const [brandName, setBrandName] = useState("");
    const router = useRouter();
    const api = process.env.NEXT_PUBLIC_API_URL || "/api";

    useEffect(() => {
        const message = new URLSearchParams(window.location.search).get("google_error");
        if (message) {
            toast.error(message);
            window.history.replaceState(null, "", "/admin/login");
        }
    }, []);

    async function continueWithGoogle() {
        if (register && (!name.trim() || !brandName.trim())) {
            toast.error("Enter your name and photography brand first");
            return;
        }
        setGoogleLoading(true);
        try {
            const params = new URLSearchParams({mode: register ? "register" : "login"});
            if (register) {
                params.set("name", name.trim());
                params.set("brand_name", brandName.trim());
            }
            const response = await fetch(`${api}/auth/google/signin-url?${params}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not start Google sign-in");
            window.location.assign(data.url);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not start Google sign-in");
            setGoogleLoading(false);
        }
    }

    async function submit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        const form = new FormData(e.currentTarget);
        try {
            const response = await fetch(`${api}/auth/${register ? "register" : "login"}`, register ? {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.fromEntries(form.entries()))
            } : {
                method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ username: String(form.get("email")), password: String(form.get("password")) })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Account request failed");
            Cookies.set("admin_token", data.access_token, { expires: 1, sameSite: "strict", secure: location.protocol === "https:" });
            router.push("/admin/dashboard");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Please try again");
        } finally { setLoading(false); }
    }

    return <div className="auth-page">
        <section className="auth-intro">
            <p className="eyebrow">[ FOR THE PEOPLE BEHIND THE CAMERA ]</p>
            <Camera size={68} strokeWidth={1} aria-hidden="true" />
            <h1>YOUR BRAND.<br /><span>YOUR FRAMES.</span></h1>
            <p>Create an event, connect your Drive, and let every guest find their own moments.</p>
            <div className="auth-sequence">01 / SIGN IN <span>→</span> 02 / CREATE EVENT <span>→</span> 03 / SHARE LINK</div>
        </section>
        <section className="auth-form-panel">
            <p className="eyebrow">[ PHOTOGRAPHER ACCESS ]</p>
            <h2>{register ? "CREATE ACCOUNT" : "WELCOME BACK"}<span>_</span></h2>
            <p className="auth-helper">{register ? "Start your PICSHARE workspace." : "Sign in to manage your events."}</p>
            <form onSubmit={submit} className="auth-fields">
                {register && <><div><Label htmlFor="name">YOUR NAME</Label><Input id="name" name="name" required autoComplete="name" maxLength={100} value={name} onChange={e => setName(e.target.value)} /></div>
                    <div><Label htmlFor="brand_name">PHOTOGRAPHY BRAND</Label><Input id="brand_name" name="brand_name" required autoComplete="organization" maxLength={100} value={brandName} onChange={e => setBrandName(e.target.value)} /></div></>}
                <div><Label htmlFor="email">EMAIL ADDRESS</Label><Input id="email" name="email" type="email" required autoComplete="email" /></div>
                <div><Label htmlFor="password">PASSWORD</Label><Input id="password" name="password" type="password" minLength={register ? 12 : undefined} required autoComplete={register ? "new-password" : "current-password"} /></div>
                {register && <p className="auth-hint">USE AT LEAST 12 CHARACTERS.</p>}
                <Button className="auth-submit" disabled={loading}>{loading ? "PLEASE WAIT..." : register ? "CREATE ACCOUNT" : "LOG IN"}<ArrowUpRight size={17} /></Button>
            </form>
            <div className="auth-divider"><span>OR</span></div>
            <Button type="button" variant="outline" className="auth-google" disabled={loading || googleLoading} onClick={continueWithGoogle}>
                <span className="auth-google-mark" aria-hidden="true">G</span>
                {googleLoading ? "CONNECTING TO GOOGLE..." : register ? "CREATE ACCOUNT WITH GOOGLE" : "CONTINUE WITH GOOGLE"}
                <ArrowUpRight size={17} />
            </Button>
            {register && <p className="auth-google-note">Enter your name and brand above, then choose Google. Email and password are only needed for the other option.</p>}
            <button type="button" className="auth-switch" onClick={() => setRegister(!register)}>{register ? "ALREADY HAVE AN ACCOUNT? LOG IN →" : "NEW HERE? CREATE AN ACCOUNT →"}</button>
        </section>
    </div>;
}
