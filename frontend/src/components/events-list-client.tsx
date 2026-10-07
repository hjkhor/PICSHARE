"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calendar, Lock, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PublicEvent {
  _id: string;
  name: string;
  slug: string;
  date: string;
  brand_name?: string;
  is_protected: boolean;
}

export default function EventsListClient() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [verifying, setVerifying] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const router = useRouter();
  const api = process.env.NEXT_PUBLIC_API_URL || "/api";

  useEffect(() => {
    fetch(`${api}/events/public/list`).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setEvents).catch(() => toast.error("Could not load events"))
      .finally(() => setLoading(false));
  }, [api]);

  async function openEvent(event: PublicEvent) {
    if (!event.is_protected) { router.push(`/event/${event.slug}`); return; }
    if (verifying !== event._id) { setVerifying(event._id); setCode(""); return; }
    if (!code.trim()) { toast.error("Enter the event code"); return; }
    try {
      const res = await fetch(`${api}/events/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: event.slug, code }) });
      if (!res.ok) { toast.error("Invalid event code"); return; }
      sessionStorage.setItem(`event_code_${event.slug}`, code);
      router.push(`/event/${event.slug}`);
    } catch { toast.error("Could not verify the code"); }
  }

  const shown = events.filter(e => `${e.name} ${e.slug} ${e.brand_name || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="event-index">
    <div className="event-index-inner">
      <div className="event-index-header">
        <p className="eyebrow">[ THE EVENT DIRECTORY ]</p>
        <h1>FIND YOUR<br /><span>FRAME.</span></h1>
        <p>Pick your event. Add a selfie. Get straight to the moments you were part of.</p>
      </div>
      <div className="event-search"><Search size={20} aria-hidden="true" /><Input aria-label="Search events" placeholder="SEARCH EVENT OR PHOTOGRAPHER..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="event-index-meta"><span>AVAILABLE EVENTS</span><span>{String(shown.length).padStart(2, "0")} RESULTS</span></div>
      {loading ? <div className="event-empty">LOADING EVENTS _</div> : shown.length === 0 ? <div className="event-empty">NO EVENTS FOUND. TRY ANOTHER SEARCH.</div> :
        <div className="event-cards">{shown.map((event, index) => <article className="event-card" key={event._id}>
          <div className="event-card-top"><span>#{String(index + 1).padStart(3, "0")}</span>{event.is_protected && <span className="event-lock"><Lock size={13} /> ACCESS CODE</span>}</div>
          <div className="event-card-icon" aria-hidden="true"><Calendar size={29} strokeWidth={1.2} /></div>
          <div><p className="event-card-brand">{event.brand_name || "PICSHARE EVENT"}</p><h2>{event.name}</h2><p className="event-card-date">{new Date(event.date).toLocaleDateString(undefined, {day: "numeric", month: "long", year: "numeric"}).toUpperCase()}</p></div>
          {verifying === event._id && <div className="event-code"><Input aria-label="Event access code" placeholder="ENTER ACCESS CODE" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => {if(e.key === "Enter") openEvent(event);}} autoFocus /><button type="button" onClick={() => setVerifying(null)} aria-label="Cancel code entry"><X size={17} /></button></div>}
          <Button onClick={() => openEvent(event)} className="event-card-button">{verifying === event._id ? "VERIFY CODE" : "OPEN EVENT"}<ArrowRight size={16} /></Button>
        </article>)}</div>}
    </div>
  </div>;
}
