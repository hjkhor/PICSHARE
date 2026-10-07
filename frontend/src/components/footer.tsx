import Link from "next/link";

export function Footer() {
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <Link href="/" className="site-footer-logo">PICSHARE<span>.</span></Link>
      <p>YOUR MOMENTS / YOUR FRAME</p>
      <span>© {new Date().getFullYear()} PICSHARE</span>
    </div>
  </footer>;
}
