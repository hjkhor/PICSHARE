"use client";

import Link from "next/link";
import { ArrowUpRight, Camera, ScanFace, FolderSync, Share2 } from "lucide-react";

const steps = [
  { number: "01", icon: FolderSync, title: "CONNECT YOUR DRIVE", body: "Connect an event folder in Google Drive. PICSHARE indexes its photos for matching." },
  { number: "02", icon: Share2, title: "DROP THE LINK", body: "Give your guests one link to their event. Add an access code when you need one." },
  { number: "03", icon: ScanFace, title: "FIND THE FRAME", body: "Guests add a selfie and see the event photos that match them." },
];

export default function HomeClient() {
  return <div className="home-page">
    <section className="hero-shell">
      <div className="hero-copy">
        <p className="eyebrow"><span className="status-dot" /> EVENT PHOTO DELIVERY / REWIRED</p>
        <h1>EVERY<br />FRAME.<br /><span>YOUR</span> STORY.</h1>
        <p className="hero-lead">Connect your Drive, share an event link, and deliver each guest their photos.</p>
        <div className="hero-actions">
          <Link href="/admin/login" className="kippo-cta">PHOTOGRAPHER WORKSPACE <ArrowUpRight size={17} /></Link>
        </div>
        <p className="hero-footnote">[ BUILT FOR PHOTOGRAPHERS. SHARED THROUGH YOUR EVENT LINK. ]</p>
      </div>
      <div className="hero-visual" aria-label="Preview of a photo match">
        <div className="visual-topline"><span>● &nbsp; PICSHARE.EXE</span><span>FRAME_001 / LIVE</span></div>
        <div className="visual-frame">
          <div className="visual-cross visual-cross-tl">+</div><div className="visual-cross visual-cross-tr">+</div>
          <div className="visual-face"><Camera size={86} strokeWidth={0.7} /><span>YOUR MOMENT<br />GOES HERE</span></div>
          <div className="visual-scan" />
          <div className="visual-cross visual-cross-bl">+</div><div className="visual-cross visual-cross-br">+</div>
        </div>
        <div className="visual-footer"><span>FACE MATCH ENGINE</span><span className="visual-ready">READY TO SCAN _</span></div>
      </div>
    </section>

    <section className="manifesto-strip" aria-label="How it works"><span>CAPTURE IT</span><b>+</b><span>SHARE IT</span><b>+</b><span>FIND IT</span></section>

    <section className="how-section">
      <div className="section-heading"><p className="eyebrow">[ HOW IT WORKS ]</p><h2>FROM DRIVE<br />TO <span>DISCOVERY.</span></h2></div>
      <div className="step-list">{steps.map(({ number, icon: Icon, title, body }) => <article className="step-row" key={number}>
        <span className="step-number">/{number}</span><Icon size={27} strokeWidth={1.5} aria-hidden="true" /><div><h3>{title}</h3><p>{body}</p></div><ArrowUpRight size={18} aria-hidden="true" />
      </article>)}</div>
    </section>

    <section className="end-cta"><p className="eyebrow">[ THE NEXT FRAME IS YOURS ]</p><h2>READY TO<br /><span>DELIVER?</span></h2><Link href="/admin/login" className="kippo-cta">OPEN YOUR WORKSPACE <ArrowUpRight size={17} /></Link></section>
  </div>;
}
