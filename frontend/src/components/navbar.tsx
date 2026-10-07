"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Cookies from "js-cookie";
import { ArrowUpRight, Menu, X } from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setReady(true), []);
  useEffect(() => setOpen(false), [pathname]);
  const signedIn = ready && Boolean(Cookies.get("admin_token"));

  return <header className="site-header">
    <nav className="site-nav" aria-label="Main navigation">
      <Link href="/" className="site-logo" aria-label="PICSHARE home">
        <span className="site-logo-mark" aria-hidden="true">[+]</span>
        PIC<span>SHARE</span><b>.</b>
      </Link>
      <button className="site-menu-toggle" type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      <div className={`site-links ${open ? "is-open" : ""}`}>
        <Link href={signedIn ? "/admin/dashboard" : "/admin/login"} className={pathname.startsWith("/admin") ? "is-active" : ""}>
          {signedIn ? "Dashboard" : "Photographer login"}
        </Link>
        <Link href={signedIn ? "/admin/dashboard" : "/admin/login"} className="site-nav-cta">
          {signedIn ? "My workspace" : "Create a brand"}<ArrowUpRight size={15} />
        </Link>
      </div>
    </nav>
  </header>;
}
