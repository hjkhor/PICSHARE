"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Loader2, Calendar, Globe, LogOut, Copy, Check, RefreshCw, Link as LinkIcon, ExternalLink, Users, X, Trash2, Search, Image as ImageIcon, HardDrive, ChevronDown } from "lucide-react";
import Cookies from "js-cookie";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

function PrivateImage({src, alt, className, onClick, onError}: {src: string; alt: string; className?: string; onClick?: () => void; onError?: React.ReactEventHandler<HTMLImageElement>}) {
    const [url, setUrl] = useState<string>();
    useEffect(() => {
        const controller = new AbortController();
        let objectUrl: string | undefined;
        fetch(src, {headers: {Authorization: `Bearer ${Cookies.get("admin_token")}`}, signal: controller.signal})
            .then(r => {if (!r.ok) throw new Error("Image unavailable"); return r.blob();})
            .then(blob => {objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);})
            .catch(() => {});
        return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
    }, [src]);
    return url ? <img src={url} alt={alt} className={className} onClick={onClick} onError={onError} /> : <div className={className} aria-label={alt} />;
}

interface Event {
    _id: string;
    name: string;
    slug: string;
    date: string;
    created_at: string;
    drive_folder_url?: string;
    secret_code?: string;
    sync_status?: string;
    last_sync_at?: string;
}

interface Guest {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    selfie_path?: string;
    status: string;
    match_count: number;
    created_at: string;
    gallery_link: string;
}

interface Photo {
    id: string;
    original_file_name: string;
    thumbnail_path?: string;
    width?: number;
    height?: number;
    faces_count: number;
    status: string;
    created_at: string;
    drive_file_id?: string;
}

interface EventStatusData {
    total: number;
    pending: number;
    processed: number;
    errors: number;
    total_faces: number;
    progress: number;
    sync_status: string;
}

interface StorageInfo {
    event_storage_bytes: number;
    event_storage_mb: number;
    event_storage_gb: number;
    total_storage_bytes: number;
    total_storage_gb: number;
    free_storage_bytes: number;
    free_storage_gb: number;
    used_storage_bytes: number;
    used_storage_gb: number;
    photo_count: number;
    guest_count: number;
}

const EventStatus = ({ eventId, apiUrl, syncStatus, lastSyncAt, onSyncComplete }: {
    eventId: string,
    apiUrl: string,
    syncStatus?: string,
    lastSyncAt?: string,
    onSyncComplete: () => void
}) => {
    const [status, setStatus] = useState<EventStatusData | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const wasSyncingRef = useRef(syncStatus === "syncing");

    useEffect(() => {
        const fetchStatus = async () => {
            const token = Cookies.get("admin_token");
            try {
                const res = await fetch(`${apiUrl}/photos/status/${eventId}`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setStatus(data);

                    // Stop polling if fully complete

                    const syncDone = data.sync_status === "completed" || data.sync_status === "idle";
                    const processingDone = data.pending === 0;

                    if (syncDone && processingDone && pollRef.current) {
                        clearInterval(pollRef.current);
                        pollRef.current = null;

                        // If it was syncing and now it's done, tell parent to refresh once
                        if (wasSyncingRef.current) {
                            onSyncComplete();
                            wasSyncingRef.current = false;
                        }
                    }

                    if (data.sync_status === "syncing") {
                        wasSyncingRef.current = true;
                    }
                }
            } catch (error: unknown) {
                console.error("Status fetch error:", error);
            }
        };

        fetchStatus();
        pollRef.current = setInterval(fetchStatus, 5000);
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [eventId, apiUrl, syncStatus, lastSyncAt, onSyncComplete]);

    if (!status) return <div className="h-2 w-full bg-muted animate-pulse rounded-full mt-2" />;

    return (
        <div className="space-y-2 mt-3 text-foreground transition-colors">
            <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Indexing Progress</span>
                <span className="flex items-center gap-1">
                    {status.sync_status === "syncing" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                    {status.progress >= 100 && status.sync_status !== "syncing" ? "Fully Indexed" : `${Math.round(status.progress)}%`}
                </span>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-500 rounded-full ${status.errors > 0 ? 'bg-amber-500' : 'bg-indigo-600 dark:bg-indigo-500'}`}
                    style={{ width: `${status.progress}%` }}
                />
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border mt-2">
                <div className="text-left pt-1">
                    <p className="text-[10px] text-muted-foreground leading-none mb-1">Photos</p>
                    <p className="font-bold text-foreground text-[12px]">{status.processed}/{status.total}</p>
                </div>
                <div className="text-left border-l border-border pl-2 pt-1">
                    <p className="text-[10px] text-muted-foreground leading-none mb-1">Faces</p>
                    <p className="font-bold text-foreground text-[12px]">{status.total_faces}</p>
                </div>
                <div className="text-left border-l border-border pl-2 pt-1">
                    <p className="text-[10px] text-muted-foreground leading-none mb-1 text-left">Errors</p>
                    <p className={`font-bold text-[12px] ${status.errors > 0 ? 'text-red-500' : 'text-foreground'}`}>{status.errors}</p>
                </div>
            </div>
        </div>
    );
};

const StorageDisplay = ({ eventId, apiUrl }: { eventId: string, apiUrl: string }) => {
    const [storage, setStorage] = useState<StorageInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        const fetchStorage = async () => {
            const token = Cookies.get("admin_token");
            try {
                const res = await fetch(`${apiUrl}/events/${eventId}/storage`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setStorage(data);
                }
            } catch (error: unknown) {
                console.error("Storage fetch error:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStorage();
    }, [eventId, apiUrl]);

    if (loading) return <div className="h-16 w-full bg-muted animate-pulse rounded-lg mt-2" />;
    if (!storage) return null;

    const formatSize = (bytes: number) => {
        if (bytes >= 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        } else if (bytes >= 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        } else if (bytes >= 1024) {
            return `${(bytes / 1024).toFixed(2)} KB`;
        }
        return `${bytes} B`;
    };

    const usagePercent = storage.total_storage_bytes > 0
        ? (storage.used_storage_bytes / storage.total_storage_bytes) * 100
        : 0;

    return (
        <div className="space-y-2 mt-3 p-3 bg-muted/40 rounded-xl">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center mb-0 justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
                <span className="flex items-center gap-1">
                    <HardDrive className="w-3 h-3" />
                    Storage Usage
                </span>
                <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                />
            </button>

            <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                {/* Event Storage */}
                <div className="space-y-1 pt-2">
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground">Event Storage</span>
                        <span className="font-bold text-foreground">{formatSize(storage.event_storage_bytes)}</span>
                    </div>
                </div>

                {/* System Storage */}
                <div className="space-y-1 pt-2 border-t border-border mt-2">
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground">System Used</span>
                        <span className="font-bold text-foreground">{formatSize(storage.used_storage_bytes)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground">Free</span>
                        <span className="font-bold text-green-600 dark:text-green-400">{formatSize(storage.free_storage_bytes)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground">Total</span>
                        <span className="font-bold text-foreground">{formatSize(storage.total_storage_bytes)}</span>
                    </div>

                    {/* Storage Bar */}
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden mt-2">
                        <div
                            className={`h-full transition-all duration-500 rounded-full ${usagePercent > 90 ? 'bg-red-500' :
                                    usagePercent > 75 ? 'bg-amber-500' :
                                        'bg-green-500'
                                }`}
                            style={{ width: `${Math.min(usagePercent, 100)}%` }}
                        />
                    </div>
                    <div className="text-[9px] text-muted-foreground text-right">
                        {usagePercent.toFixed(1)}% used
                    </div>
                </div>
            </div>
        </div>
    );
};

const CopyButton = ({ slug }: { slug: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        const url = `${window.location.origin}/event/${slug}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        toast.success("URL copied to clipboard!");
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-9 w-9 p-0 text-foreground border border-border flex-shrink-0 bg-card hover:bg-purple-50 dark:hover:bg-purple-900/20"
        >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
    );
};

export default function AdminDashboardClient() {
    const [events, setEvents] = useState<Event[]>([]);
    const [profile, setProfile] = useState<{name: string; brand_name: string; drive_connected: boolean; google_email?: string; google_signin_enabled: boolean} | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [syncing, setSyncing] = useState<Record<string, boolean>>({});
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [driveUrl, setDriveUrl] = useState("");
    const [showGuestsModal, setShowGuestsModal] = useState(false);
    const [selectedEventForGuests, setSelectedEventForGuests] = useState<Event | null>(null);
    const [guests, setGuests] = useState<Guest[]>([]);
    const [loadingGuests, setLoadingGuests] = useState(false);
    const [guestFilter, setGuestFilter] = useState("");
    const [showGalleryModal, setShowGalleryModal] = useState(false);
    const [selectedEventForGallery, setSelectedEventForGallery] = useState<Event | null>(null);
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loadingPhotos, setLoadingPhotos] = useState(false);
    const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
    const [deletingPhotos, setDeletingPhotos] = useState(false);


    const router = useRouter();
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

    const fetchEvents = useCallback(async () => {
        try {
            const token = Cookies.get("admin_token");
            const response = await fetch(`${API_URL}/events`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setEvents(data);
            }
        } catch (error) {
            console.error("Fetch events error:", error);
            toast.error("Failed to load events");
        } finally {
            setLoading(false);
        }
    }, [API_URL]);

    useEffect(() => {
        const token = Cookies.get("admin_token");
        if (!token) {
            router.push("/admin/login");
            return;
        }
        fetchEvents();
        fetch(`${API_URL}/auth/me`, {headers: {Authorization: `Bearer ${token}`}}).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setProfile).catch(() => { Cookies.remove("admin_token"); router.push("/admin/login"); });
    }, [router, fetchEvents, API_URL]);

    // Poll for event list updates if any event is syncing
    useEffect(() => {
        const isAnySyncing = events.some(e => e.sync_status === "syncing");

        if (isAnySyncing) {
            const interval = setInterval(fetchEvents, 5000);
            return () => clearInterval(interval);
        }
    }, [events, fetchEvents]);

    const handleCreateEvent = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setCreating(true);
        const token = Cookies.get("admin_token");
        const formData = new FormData(e.currentTarget);

        const payload = {
            name: formData.get("name"),
            slug: formData.get("slug"),
            date: new Date(formData.get("date") as string).toISOString(),
            drive_folder_url: formData.get("drive_folder_url"),
            secret_code: formData.get("secret_code")
        };

        try {
            const response = await fetch(`${API_URL}/events`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                toast.success("Event created successfully");
                fetchEvents();
                (e.target as HTMLFormElement).reset();
            } else {
                const err = await response.json();
                toast.error(err.detail || "Failed to create event");
            }
        } catch (error) {
            console.error("Create event error:", error);
            toast.error("Network error");
        } finally {
            setCreating(false);
        }
    };

    const handleSyncPhotos = async (eventId: string) => {
        setSyncing(prev => ({ ...prev, [eventId]: true }));
        const token = Cookies.get("admin_token");

        try {
            const response = await fetch(`${API_URL}/photos/sync/${eventId}`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (response.ok) {
                toast.success("Started syncing photos from Google Drive");
                setTimeout(() => fetchEvents(), 2000)
                return;
            } else {
                toast.error("Sync failed to start");
            }
        } catch (error) {
            console.error("Sync error:", error);
            toast.error("Network error during sync");
        } finally {
            setTimeout(() => {
                setSyncing(prev => ({ ...prev, [eventId]: false }));
            }, 2000);
        }
    };

    const handleUpdateDriveUrl = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEventId || !driveUrl) return;

        const token = Cookies.get("admin_token");
        try {
            const response = await fetch(`${API_URL}/events/${selectedEventId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ drive_folder_url: driveUrl })
            });

            if (response.ok) {
                toast.success("Drive folder updated. You can now start sync.");
                setDriveUrl("");
                setSelectedEventId(null);
                fetchEvents();
            } else {
                toast.error("Failed to update Drive URL");
            }
        } catch (error) {
            console.error("Update error:", error);
            toast.error("Network error");
        }
    };

    const handleConnectDrive = async () => {
        const token = Cookies.get("admin_token");
        const response = await fetch(`${API_URL}/auth/google/connect`, {headers: {Authorization: `Bearer ${token}`}});
        const data = await response.json();
        if (response.ok) window.location.assign(data.url);
        else toast.error(data.detail || "Could not connect Google Drive");
    };

    const handleLinkGoogleSignin = async () => {
        try {
            const token = Cookies.get("admin_token");
            const response = await fetch(`${API_URL}/auth/google/link`, {headers: {Authorization: `Bearer ${token}`}});
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not enable Google sign-in");
            window.location.assign(data.url);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not enable Google sign-in");
        }
    };

    const openPrivatePhoto = async (photoId: string) => {
        const response = await fetch(`${API_URL}/photos/original/${photoId}`, {headers: {Authorization: `Bearer ${Cookies.get("admin_token")}`}});
        if (!response.ok) {toast.error("Could not open photo"); return;}
        const url = URL.createObjectURL(await response.blob());
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    };

    const handleLogout = () => {
        Cookies.remove("admin_token");
        router.push("/admin/login");
    };

    const handleShowGuests = async (event: Event) => {
        setSelectedEventForGuests(event);
        setShowGuestsModal(true);
        setLoadingGuests(true);
        setGuestFilter(""); // Reset filter when opening modal

        try {
            const token = Cookies.get("admin_token");
            const response = await fetch(`${API_URL}/guests/event/${event._id}`, {
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setGuests(data.guests || []);
            } else {
                toast.error("Failed to load guests");
            }
        } catch (error) {
            console.error("Error fetching guests:", error);
            toast.error("Network error");
        } finally {
            setLoadingGuests(false);
        }
    };

    const handleDeleteGuest = async (guestId: string, guestName: string) => {
        if (!confirm(`Are you sure you want to remove ${guestName}? This will allow them to rescan their face.`)) {
            return;
        }

        try {
            const token = Cookies.get("admin_token");
            const response = await fetch(`${API_URL}/guests/${guestId}`, {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (response.ok) {
                toast.success(`${guestName} removed successfully`);
                // Refresh the guests list
                if (selectedEventForGuests) {
                    handleShowGuests(selectedEventForGuests);
                }
            } else {
                toast.error("Failed to remove guest");
            }
        } catch (error) {
            console.error("Error deleting guest:", error);
            toast.error("Network error");
        }
    };

    const handleDeleteEvent = async (eventId: string, eventName: string) => {
        if (!confirm(`⚠️ WARNING: This will permanently delete "${eventName}" and ALL associated data including:\n\n• All photos and thumbnails\n• All guest selfies and data\n• All face recognition data\n\nThis action CANNOT be undone!\n\nAre you absolutely sure?`)) {
            return;
        }

        try {
            const token = Cookies.get("admin_token");
            const response = await fetch(`${API_URL}/events/${eventId}`, {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(`Event "${eventName}" deleted successfully. Removed ${data.deleted_photos} photos and ${data.deleted_guests} guests.`);
                fetchEvents(); // Refresh the events list
            } else {
                const error = await response.json();
                toast.error(error.detail || "Failed to delete event");
            }
        } catch (error) {
            console.error("Error deleting event:", error);
            toast.error("Network error");
        }
    };

    const handleShowGallery = async (event: Event) => {
        setSelectedEventForGallery(event);
        setShowGalleryModal(true);
        setLoadingPhotos(true);
        setSelectedPhotos(new Set());

        try {
            const token = Cookies.get("admin_token");
            const response = await fetch(`${API_URL}/photos/event/${event._id}/gallery?limit=1000`, {
                headers: { "Authorization": `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setPhotos(data.photos || []);
            } else {
                toast.error("Failed to load photos");
            }
        } catch (error) {
            console.error("Error fetching photos:", error);
            toast.error("Network error");
        } finally {
            setLoadingPhotos(false);
        }
    };

    const togglePhotoSelection = (photoId: string) => {
        setSelectedPhotos(prev => {
            const newSet = new Set(prev);
            if (newSet.has(photoId)) {
                newSet.delete(photoId);
            } else {
                newSet.add(photoId);
            }
            return newSet;
        });
    };

    const toggleSelectAll = () => {
        if (selectedPhotos.size === photos.length) {
            setSelectedPhotos(new Set());
        } else {
            setSelectedPhotos(new Set(photos.map(p => p.id)));
        }
    };

    const handleDeleteSelectedPhotos = async () => {
        if (selectedPhotos.size === 0) {
            toast.error("No photos selected");
            return;
        }

        if (!confirm(`Are you sure you want to delete ${selectedPhotos.size} photo(s)? This action cannot be undone.`)) {
            return;
        }

        setDeletingPhotos(true);
        try {
            const token = Cookies.get("admin_token");
            const photoIds = Array.from(selectedPhotos);

            const response = await fetch(`${API_URL}/photos/delete/bulk`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(photoIds)
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(data.message);
                // Refresh the gallery
                if (selectedEventForGallery) {
                    handleShowGallery(selectedEventForGallery);
                }
            } else {
                toast.error("Failed to delete photos");
            }
        } catch (error) {
            console.error("Error deleting photos:", error);
            toast.error("Network error");
        } finally {
            setDeletingPhotos(false);
        }
    };

    // Filter guests based on search input
    const filteredGuests = guests.filter(guest => {
        if (!guestFilter.trim()) return true;
        const searchTerm = guestFilter.toLowerCase();
        return (
            guest.name.toLowerCase().includes(searchTerm) ||
            (guest.email || "").toLowerCase().includes(searchTerm)
        );
    });

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
        );
    }

    return (
        <div className="photographer-dashboard bg-background p-6 transition-colors duration-300">
            <header className="dashboard-head max-w-6xl mx-auto flex items-center justify-between mb-8">
                <div>
                    <p className="eyebrow">[ PHOTOGRAPHER WORKSPACE ]</p>
                    <h1 className="text-3xl font-bold text-foreground font-sans tracking-tight">{profile?.brand_name || "Photographer Dashboard"}</h1>
                    <p className="text-muted-foreground">CREATE / CONNECT / SHARE</p>
                    <p className="text-sm mt-2">{profile?.drive_connected ? `Drive connected: ${profile.google_email || "Google account"}` : "Connect your Google Drive before syncing an event."}</p>
                    <Button variant="outline" className="mt-2" onClick={handleConnectDrive}>{profile?.drive_connected ? "Reconnect Google Drive" : "Connect Google Drive"}</Button>
                    {profile?.google_signin_enabled ?
                        <p className="text-xs text-muted-foreground mt-2">Google sign-in enabled</p> :
                        <Button variant="outline" className="mt-2 ml-2" onClick={handleLinkGoogleSignin}>Enable Google sign-in</Button>}
                </div>
                <Button variant="outline" onClick={handleLogout} className="gap-2 border-border bg-card hover:bg-muted">
                    <LogOut className="w-4 h-4" />
                    Logout
                </Button>
            </header>

            <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-8">
                {/* Create Event */}
                <Card className="border-border shadow-xl bg-card/80 backdrop-blur-lg">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Plus className="w-5 h-5 text-indigo-600" />
                            Create New Event
                        </CardTitle>
                        <CardDescription>Setup a new event and link a Drive folder</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleCreateEvent} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Event Name</Label>
                                    <Input id="name" name="name" placeholder="Wedding 2024" required className="bg-background border-border" />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="slug">URL Slug</Label>
                                    <Input id="slug" name="slug" placeholder="wedding-2024" required className="bg-background border-border" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="date">Event Date</Label>
                                <Input id="date" name="date" type="date" required className="bg-background border-border" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="drive_folder_url">Google Drive Folder URL</Label>
                                <Input id="drive_folder_url" name="drive_folder_url" placeholder="https://drive.google.com/..." className="bg-background border-border" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="secret_code">Secret Event Code (Optional)</Label>
                                <Input id="secret_code" name="secret_code" placeholder="Leave empty for public access" className="bg-background border-border" />
                            </div>
                            <Button className="w-full bg-indigo-600 hover:bg-indigo-700 h-11 text-white border-none shadow-lg shadow-indigo-100 dark:shadow-none" disabled={creating}>
                                {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                                Create Event
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {/* Automation Sync */}
                <Card className="border-border shadow-xl bg-card/80 backdrop-blur-lg overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full -mr-16 -mt-16 pointer-events-none opacity-50" />
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <RefreshCw className="w-5 h-5 text-indigo-600" />
                            Link Folders
                        </CardTitle>
                        <CardDescription>Update Drive URL for existing events to start indexing</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleUpdateDriveUrl} className="space-y-4">
                            <div className="space-y-2">
                                <Label>Select Event</Label>
                                <select
                                    className="w-full h-10 px-3 rounded-md border border-border bg-background focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-foreground"
                                    onChange={(e) => setSelectedEventId(e.target.value)}
                                    value={selectedEventId || ""}
                                    required
                                >
                                    <option value="" disabled>Choose an event...</option>
                                    {events.map((event) => (
                                        <option key={event._id} value={event._id}>{event.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="driveUrl">New Google Drive Folder URL</Label>
                                <div className="relative">
                                    <Input
                                        id="driveUrl"
                                        value={driveUrl}
                                        onChange={(e) => setDriveUrl(e.target.value)}
                                        placeholder="Paste link here..."
                                        required
                                        className="pr-10 bg-background border-border"
                                    />
                                    <LinkIcon className="absolute right-3 top-2.5 w-4 h-4 text-muted-foreground" />
                                </div>
                            </div>
                            <Button className="w-full bg-foreground text-background hover:bg-foreground/90 h-11 border-none shadow-lg" disabled={!selectedEventId || !driveUrl}>
                                Update Folder Path
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>

            {/* Event List */}
            <div className="max-w-6xl mx-auto mt-12">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">YOUR EVENTS</h2>
                    <div className="text-xs text-muted-foreground font-medium bg-card px-3 py-1 rounded-full border border-border shadow-sm">
                        {events.length} Events Total
                    </div>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {events.map((event) => (
                        <Card key={event._id} className="border-border shadow-md hover:shadow-xl transition-all duration-300 bg-card group overflow-hidden">
                            <CardContent className="p-5 space-y-4">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <h4 className="font-bold text-foreground group-hover:text-indigo-600 transition-colors uppercase tracking-tight text-sm">{event.name}</h4>
                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-medium">
                                            <Calendar className="w-3 h-3" />
                                            {new Date(event.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </div>
                                    </div>
                                    <Button variant="outline" size="sm" className="h-9 w-9 p-0 border-border bg-card" asChild title="Public Page">
                                        <a href={`/event/${event.slug}`} target="_blank">
                                            <Globe className="w-4 h-4 text-muted-foreground" />
                                        </a>
                                    </Button>
                                </div>

                                <div className="pt-2">
                                    <EventStatus
                                        eventId={event._id}
                                        apiUrl={API_URL}
                                        syncStatus={event.sync_status}
                                        lastSyncAt={event.last_sync_at}
                                        onSyncComplete={fetchEvents}
                                    />
                                </div>

                                <div className="pt-2">
                                    <StorageDisplay
                                        eventId={event._id}
                                        apiUrl={API_URL}
                                    />
                                </div>

                                {event.drive_folder_url && (
                                    <div className="p-3 bg-muted/40 rounded-xl space-y-2">
                                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Connected Folder</p>
                                        <a
                                            href={event.drive_folder_url}
                                            target="_blank"
                                            className="text-xs text-indigo-600 dark:text-indigo-400 truncate block hover:underline flex items-center gap-1 font-medium"
                                        >
                                            <ExternalLink className="w-3 h-3" />
                                            Visit Source Folder
                                        </a>
                                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                            <span>Last indexed:</span>
                                            <span className="font-bold">{event.last_sync_at ? new Date(event.last_sync_at).toLocaleTimeString() : 'Never'}</span>
                                        </div>
                                        {event.secret_code && (
                                            <div className="flex items-center justify-between text-[10px] text-indigo-600 font-bold border-t border-indigo-100 dark:border-indigo-900/30 pt-1 mt-1">
                                                <span>Secret Code:</span>
                                                <span>{event.secret_code}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="event-actions flex gap-2">
                                    <Button
                                        variant="default"
                                        size="sm"
                                        disabled={syncing[event._id] || !profile?.drive_connected || !event.drive_folder_url || event.sync_status === "syncing"}
                                        onClick={() => handleSyncPhotos(event._id)}
                                        className="h-9 flex-1 bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100 dark:shadow-none border-none"
                                    >
                                        {syncing[event._id] || event.sync_status === "syncing" ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <>
                                                <RefreshCw className="w-3.5 h-3.5 mr-2" />
                                                Sync Now
                                            </>
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-9 w-9 p-0 border border-border bg-card hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                                        onClick={() => handleShowGuests(event)}
                                        title="View Guests"
                                    >
                                        <Users className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-9 w-9 p-0 border border-border bg-card hover:bg-purple-50 dark:hover:bg-purple-900/20"
                                        onClick={() => handleShowGallery(event)}
                                        title="View Gallery"
                                    >
                                        <ImageIcon className="w-4 h-4" />
                                    </Button>
                                    <CopyButton slug={event.slug} />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 w-9 p-0 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                                        onClick={() => handleDeleteEvent(event._id, event.name)}
                                        title="Delete Event"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>

            {/* Guests Modal */}
            {showGuestsModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowGuestsModal(false)}>
                    <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-6xl w-full max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="p-6 border-b border-border flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30">
                            <div>
                                <h3 className="text-2xl font-bold text-foreground flex items-center gap-2">
                                    <Users className="w-6 h-6 text-indigo-600" />
                                    Event Guests
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {selectedEventForGuests?.name} - {guests.length} guest{guests.length !== 1 ? 's' : ''} joined
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowGuestsModal(false)}
                                className="h-8 w-8 p-0 rounded-full hover:bg-muted"
                            >
                                <X className="w-5 h-5" />
                            </Button>
                        </div>

                        {/* Search Filter */}
                        {!loadingGuests && guests.length > 0 && (
                            <div className="px-4 sm:px-6 pt-4 pb-2 border-b border-border">
                                <div className="relative">
                                    <Input
                                        type="text"
                                        placeholder="Search by name..."
                                        value={guestFilter}
                                        onChange={(e) => setGuestFilter(e.target.value)}
                                        className="pl-10 bg-background border-border"
                                    />
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    {guestFilter && (
                                        <button
                                            onClick={() => setGuestFilter("")}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                                {guestFilter && (
                                    <p className="text-xs text-muted-foreground mt-2">
                                        Showing {filteredGuests.length} of {guests.length} guest{guests.length !== 1 ? 's' : ''}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
                            {loadingGuests ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                                </div>
                            ) : guests.length === 0 ? (
                                <div className="text-center py-12">
                                    <Users className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                                    <p className="text-muted-foreground text-lg">No guests have joined this event yet</p>
                                </div>
                            ) : filteredGuests.length === 0 ? (
                                <div className="text-center py-12">
                                    <Users className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                                    <p className="text-muted-foreground text-lg">No guests match your search</p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setGuestFilter("")}
                                        className="mt-4"
                                    >
                                        Clear filter
                                    </Button>
                                </div>
                            ) : (
                                <div className="overflow-x-auto -mx-4 sm:mx-0">
                                    <table className="w-full min-w-[640px]">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th className="text-left p-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Guest</th>
                                                <th className="text-left p-3 text-xs font-bold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Contact</th>
                                                <th className="text-center p-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                                                <th className="text-center p-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Photos</th>
                                                <th className="text-right p-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredGuests.map((guest) => (
                                                <tr
                                                    key={guest.id}
                                                    className="border-b border-border hover:bg-muted/30 transition-colors"
                                                >
                                                    <td className="p-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="relative flex-shrink-0">
                                                                {guest.selfie_path ? (
                                                                    <PrivateImage
                                                                        src={`${API_URL}/guests/selfie/${guest.id}`}
                                                                        alt={guest.name}
                                                                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover border-2 border-indigo-200 dark:border-indigo-800"
                                                                    />
                                                                ) : (
                                                                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm sm:text-base border-2 border-indigo-200 dark:border-indigo-800">
                                                                        {guest.name.charAt(0).toUpperCase()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-bold text-foreground text-sm sm:text-base truncate">{guest.name}</p>
                                                                {guest.email && <p className="text-xs text-muted-foreground truncate sm:hidden">{guest.email}</p>}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-3 hidden sm:table-cell">
                                                        {guest.email && <p className="text-sm text-foreground truncate">{guest.email}</p>}
                                                        {guest.phone && (
                                                            <p className="text-xs text-muted-foreground mt-0.5">{guest.phone}</p>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${guest.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                                                            guest.status === 'processing' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                                                                'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                                            }`}>
                                                            <span className={`w-1.5 h-1.5 rounded-full ${guest.status === 'completed' ? 'bg-green-500' :
                                                                guest.status === 'processing' ? 'bg-yellow-500' :
                                                                    'bg-red-500'
                                                                }`} />
                                                            {guest.status}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <p className="text-xl sm:text-2xl font-bold text-indigo-600 dark:text-indigo-400">{guest.match_count}</p>
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <Button
                                                                variant="default"
                                                                size="sm"
                                                                className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1 h-8 text-xs"
                                                                asChild
                                                            >
                                                                <a href={guest.gallery_link} target="_blank" rel="noopener noreferrer">
                                                                    <ExternalLink className="w-3 h-3" />
                                                                    <span className="hidden sm:inline">Gallery</span>
                                                                </a>
                                                            </Button>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 w-8 p-0"
                                                                onClick={() => handleDeleteGuest(guest.id, guest.name)}
                                                                title="Remove guest"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Gallery Modal */}
            {showGalleryModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowGalleryModal(false)}>
                    <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-7xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="p-6 border-b border-border flex items-center justify-between bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30">
                            <div>
                                <h3 className="text-2xl font-bold text-foreground flex items-center gap-2">
                                    <ImageIcon className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                                    Photo Gallery
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {selectedEventForGallery?.name} - {photos.length} photo{photos.length !== 1 ? 's' : ''}
                                    {selectedPhotos.size > 0 && ` (${selectedPhotos.size} selected)`}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowGalleryModal(false)}
                                className="h-8 w-8 p-0 rounded-full hover:bg-muted"
                            >
                                <X className="w-5 h-5" />
                            </Button>
                        </div>

                        {/* Action Bar */}
                        {!loadingPhotos && photos.length > 0 && (
                            <div className="px-6 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedPhotos.size === photos.length && photos.length > 0}
                                            onChange={toggleSelectAll}
                                            className="w-4 h-4 rounded border-border"
                                        />
                                        <span className="text-sm font-medium">Select All</span>
                                    </label>
                                    {selectedPhotos.size > 0 && (
                                        <span className="text-sm text-muted-foreground">
                                            {selectedPhotos.size} of {photos.length} selected
                                        </span>
                                    )}
                                </div>
                                {selectedPhotos.size > 0 && (
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={handleDeleteSelectedPhotos}
                                        disabled={deletingPhotos}
                                        className="gap-2"
                                    >
                                        {deletingPhotos ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-4 h-4" />
                                        )}
                                        Delete Selected ({selectedPhotos.size})
                                    </Button>
                                )}
                            </div>
                        )}

                        <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
                            {loadingPhotos ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                                </div>
                            ) : photos.length === 0 ? (
                                <div className="text-center py-12">
                                    <ImageIcon className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                                    <p className="text-muted-foreground text-lg">No photos in this event yet</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                    {photos.map((photo) => (
                                        <div
                                            key={photo.id}
                                            className={`relative group rounded-lg overflow-hidden border-2 transition-all ${selectedPhotos.has(photo.id)
                                                ? 'border-purple-500 ring-2 ring-purple-200 dark:ring-purple-800'
                                                : 'border-border hover:border-purple-300 dark:hover:border-purple-700'
                                                }`}
                                        >
                                            {/* Selection Checkbox */}
                                            <div className="absolute top-2 left-2 z-10">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedPhotos.has(photo.id)}
                                                    onChange={() => togglePhotoSelection(photo.id)}
                                                    className="w-5 h-5 rounded border-2 border-white shadow-lg cursor-pointer"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>

                                            {/* Photo */}
                                            <div className="aspect-square bg-muted relative">
                                                <PrivateImage
                                                    src={`${API_URL}/photos/thumbnail/${photo.id}`}
                                                    alt={photo.original_file_name}
                                                    className="w-full h-full object-cover cursor-pointer"
                                                    onClick={() => togglePhotoSelection(photo.id)}
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3ENo Image%3C/text%3E%3C/svg%3E';
                                                    }}
                                                />

                                                {/* Overlay with info */}
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                                                    <p className="text-white text-xs text-center truncate w-full px-2">
                                                        {photo.original_file_name}
                                                    </p>
                                                    {photo.faces_count > 0 && (
                                                        <div className="bg-white/20 backdrop-blur-sm px-2 py-1 rounded text-white text-xs">
                                                            {photo.faces_count} face{photo.faces_count !== 1 ? 's' : ''}
                                                        </div>
                                                    )}
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        className="h-7 text-xs"
                                                        asChild
                                                    >
                                                        <button type="button" onClick={() => openPrivatePhoto(photo.id)}>View Full</button>
                                                    </Button>
                                                </div>
                                            </div>

                                            {/* Status Badge */}
                                            {photo.status !== 'processed' && (
                                                <div className="absolute top-2 right-2 z-10">
                                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${photo.status === 'pending' ? 'bg-yellow-500 text-white' :
                                                        photo.status === 'error' ? 'bg-red-500 text-white' :
                                                            'bg-gray-500 text-white'
                                                        }`}>
                                                        {photo.status}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
