"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Archive, ArrowLeft, ChevronLeft, ChevronRight, Download, Image as ImageIcon, Loader2, X } from "lucide-react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

interface Photo {
    id: string;
    filename: string;
    thumbnail_url: string;
    preview_url: string;
    original_url: string;
    drive_file_id: string;
}

interface GuestData {
    guest_name: string;
    match_count: number;
    photos: Photo[];
    total_pages: number;
}

export default function GuestGalleryClient() {
    const params = useParams();
    const router = useRouter();
    const guestId = params.guestId as string;

    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<GuestData | null>(null);
    const [processing, setProcessing] = useState(false);
    const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
    const [page, setPage] = useState(1);
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [downloadingZip, setDownloadingZip] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [bytesLoaded, setBytesLoaded] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const [downloadStartTime, setDownloadStartTime] = useState<number | null>(null);

    // Touch gesture states for mobile swipe
    const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
    const [touchEnd, setTouchEnd] = useState<{ x: number; y: number } | null>(null);
    const [isZoomed, setIsZoomed] = useState(false);

    const API_URL = process.env.NEXT_PUBLIC_API_URL;

    const fetchMatches = useCallback(async (pageNum: number) => {
        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/guests/${guestId}/matches?page=${pageNum}&limit=50`);
            if (!res.ok) throw new Error("Failed to load your gallery.");
            const result = await res.json();

            setData(result);
            setAllPhotos(result.photos);

            // Scroll to top of gallery on change
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (error) {
            toast.error("Could not load your photos. Please try again.");
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [guestId, API_URL]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformComponentRef = useRef<any>(null);

    useEffect(() => {
        if (guestId) fetchMatches(1);
    }, [guestId, fetchMatches]);

    useEffect(() => {
        if (!data || data.match_count > 0 || allPhotos.length > 0) return;
        let active = true;
        const checkStatus = async () => {
            try {
                const res = await fetch(`${API_URL}/guests/status/${guestId}`);
                if (!res.ok || !active) return;
                const status = await res.json();
                if (!active) return;
                setProcessing(status.status === "processing");
                if (status.status === "completed" && status.match_count > 0) {
                    fetchMatches(1);
                }
            } catch {
                // Keep the gallery available while the connection is interrupted.
            }
        };
        checkStatus();
        const interval = setInterval(checkStatus, 3000);
        return () => { active = false; clearInterval(interval); };
    }, [data, allPhotos.length, API_URL, guestId, fetchMatches]);

    // Browser history management for preview
    useEffect(() => {
        if (previewIndex !== null) {
            setPreviewLoading(true);
            setIsZoomed(false); // Reset zoom state
            // Reset actual transform if ref exists
            if (transformComponentRef.current) {
                transformComponentRef.current.resetTransform();
            }
            // Push history state when preview opens
            window.history.pushState({ previewOpen: true }, '');
        }
    }, [previewIndex]);

    // Handle back button to close preview
    useEffect(() => {
        const handlePopState = (e: PopStateEvent) => {
            if (previewIndex !== null) {
                e.preventDefault();
                setPreviewIndex(null);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [previewIndex]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (previewIndex === null || allPhotos.length === 0) return;

            if (e.key === "ArrowRight") {
                setPreviewIndex((prev) => (prev !== null && prev < allPhotos.length - 1 ? prev + 1 : prev));
            } else if (e.key === "ArrowLeft") {
                setPreviewIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
            } else if (e.key === "Escape") {
                closePreview();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [previewIndex, allPhotos]);

    const closePreview = () => {
        setPreviewIndex(null);
        // Go back if we pushed a state
        if (window.history.state?.previewOpen) {
            window.history.back();
        }
    };

    const handleDownloadAll = async () => {
        if (!data || data.match_count === 0) return;

        setDownloadingZip(true);
        setDownloadProgress(0);
        setBytesLoaded(0);
        setTotalBytes(0);
        setDownloadStartTime(Date.now());

        try {
            const res = await fetch(`${API_URL}/guests/${guestId}/download-zip`);
            if (!res.ok) throw new Error("ZIP creation failed");

            const contentLength = res.headers.get('Content-Length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            setTotalBytes(total);
            let loaded = 0;
            const reader = res.body?.getReader();
            if (!reader) throw new Error("Could not initialize download stream");

            const chunks: Uint8Array[] = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (value) {
                    chunks.push(value);
                    loaded += value.length;
                    setBytesLoaded(loaded);

                    if (total) {
                        setDownloadProgress(Math.round((loaded / total) * 100));
                    }
                }
            }
            const blob = new Blob(chunks as unknown as BlobPart[], { type: 'application/x-zip-compressed' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${data.guest_name}_all_photos.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            toast.success("Download started!");
        } catch (error) {
            console.error("ZIP Download error:", error);
            toast.error("Failed to create ZIP file. Please try downloading individual photos.");
        } finally {
            setDownloadingZip(false);
            setDownloadProgress(0);
            setBytesLoaded(0);
            setTotalBytes(0);
            setDownloadStartTime(null);
        }
    };

    const handlePageChange = (newPage: number) => {
        if (!data || newPage < 1 || newPage > data.total_pages) return;
        setPage(newPage);
        fetchMatches(newPage);
    };

    const handleDownload = async (photoId: string, filename: string) => {
        toast.info("Preparing download...");
        try {
            const res = await fetch(`${API_URL}/photos/download/${photoId}?guest_id=${guestId}`);
            if (!res.ok) throw new Error("Download failed");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename || `photo-${photoId}.jpg`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error("Download error:", error);
            toast.error("Failed to download photo.");
        }
    };

    // Touch gesture handlers for mobile swipe navigation
    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 1 && !isZoomed) {
            setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
            setTouchEnd(null);
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 1 && touchStart && !isZoomed) {
            setTouchEnd({ x: e.touches[0].clientX, y: e.touches[0].clientY });
        }
    };

    const handleTouchEnd = () => {
        if (!touchStart || !touchEnd || isZoomed) {
            setTouchStart(null);
            setTouchEnd(null);
            return;
        }

        const deltaX = touchStart.x - touchEnd.x;
        const deltaY = touchStart.y - touchEnd.y;
        const minSwipeDistance = 30;

        // Ensure horizontal movement is significant and dominant
        if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5 && Math.abs(deltaX) > minSwipeDistance) {
            if (deltaX > 0 && previewIndex !== null && previewIndex < allPhotos.length - 1) {
                // Swipe left - next photo
                setPreviewIndex(previewIndex + 1);
            } else if (deltaX < 0 && previewIndex !== null && previewIndex > 0) {
                // Swipe right - previous photo
                setPreviewIndex(previewIndex - 1);
            }
        }

        setTouchStart(null);
        setTouchEnd(null);
    };

    const currentPreviewPhoto = previewIndex !== null ? allPhotos[previewIndex] : null;

    if (loading || processing) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-4" />
                <p className="text-muted-foreground font-medium animate-pulse">Assembling your personal gallery...</p>
            </div>
        );
    }

    if (!data || allPhotos.length === 0) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
                <Card className="max-w-md w-full text-center p-8 border border-border shadow-xl bg-card">
                    <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                        <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-2xl font-bold mb-2">No Photos Found Yet</h3>
                    <p className="text-muted-foreground mb-6">
                        We haven&apos;t found any matches for your selfie in this event.
                        If photos were just uploaded, please check back in a few minutes!
                    </p>
                    <Button onClick={() => router.back()} variant="outline" className="w-full">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Event
                    </Button>
                </Card>
            </div>
        );
    }

    return (
        <div className="guest-gallery bg-background text-foreground transition-colors duration-300">
            {/* Gallery Header */}
            <header className="sticky top-0 z-30 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container mx-auto px-4 h-16 flex items-center justify-between max-w-6xl">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.back()}
                            className="gap-2 text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            <span className="hidden sm:inline">Back</span>
                        </Button>
                        <div className="h-6 w-px bg-border hidden sm:block" />
                        <div>
                            <h2 className="font-bold text-foreground leading-none">{data.guest_name}&apos;S GALLERY</h2>
                            <p className="text-[11px] text-muted-foreground mt-1">{data.match_count} photos matched</p>
                        </div>
                    </div>

                    <Button
                        variant="default"
                        size="sm"
                        onClick={handleDownloadAll}
                        disabled={downloadingZip || data.match_count === 0}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-lg shadow-indigo-100 dark:shadow-none font-bold"
                    >
                        {downloadingZip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                        <span className="hidden sm:inline">Download All (ZIP)</span>
                        <span className="sm:hidden">ZIP</span>
                    </Button>
                </div>
            </header>

            {/* Premium Download Chip Overlay */}
            {downloadingZip && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-indigo-100 dark:border-indigo-500/20 shadow-[0_20px_50px_rgba(0,0,0,0.2)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)] rounded-3xl p-5 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200 dark:shadow-none">
                                    <Archive className="w-5 h-5 animate-pulse" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-900 dark:text-white leading-tight">Downloading Photos</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                        {bytesLoaded > 0 ? (
                                            <>
                                                {(bytesLoaded / 1024 / 1024).toFixed(1)}MB
                                                {totalBytes > 0 && ` of ${(totalBytes / 1024 / 1024).toFixed(1)}MB`}
                                            </>
                                        ) : "Preparing files..."}
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
                                    {downloadProgress}%
                                </span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden p-0.5">
                                <div
                                    className="bg-gradient-to-r from-indigo-500 to-indigo-700 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(79,70,229,0.4)]"
                                    style={{ width: `${downloadProgress}%` }}
                                />
                            </div>

                            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                <span>
                                    {totalBytes > 0 && downloadStartTime && bytesLoaded > 0 ? (
                                        (() => {
                                            const elapsed = (Date.now() - downloadStartTime) / 1000;
                                            const speed = bytesLoaded / elapsed;
                                            const remaining = (totalBytes - bytesLoaded) / speed;
                                            if (remaining > 60) return `${Math.ceil(remaining / 60)}m remaining`;
                                            return `${Math.ceil(remaining)}s remaining`;
                                        })()
                                    ) : "Calculating..."}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Live Sync | Do Not Refresh
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <main className="container mx-auto px-4 py-8 max-w-6xl">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
                    {allPhotos.map((photo, index) => (
                        <Card
                            key={`${photo.id}-${index}`}
                            className="group relative overflow-hidden border-none shadow-md hover:shadow-2xl transition-all duration-300 bg-card cursor-zoom-in"
                            onClick={() => setPreviewIndex(index)}
                        >
                            <CardContent className="p-0 aspect-[3/4] overflow-hidden bg-muted">
                                <Image
                                    src={`${API_URL}${photo.thumbnail_url}`}
                                    alt={photo.filename}
                                    fill
                                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                                    unoptimized
                                    sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 20vw"
                                />

                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-[10px] text-white/80 truncate font-medium">
                                            {photo.filename}
                                        </p>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDownload(photo.id, photo.filename);
                                            }}
                                            className="bg-white text-slate-900 p-2 rounded-full hover:bg-indigo-600 hover:text-white transition-colors shadow-lg"
                                            title="Download Original"
                                        >
                                            <Download className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Proper Pagination */}
                {data && data.total_pages > 1 && (
                    <div className="mt-16 flex flex-col items-center gap-6">
                        <div className="flex items-center gap-2 bg-muted/30 backdrop-blur-md p-1.5 rounded-2xl border border-border/50 shadow-sm">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handlePageChange(page - 1)}
                                disabled={page === 1}
                                className="rounded-xl hover:bg-background h-10 w-10"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </Button>

                            <div className="flex items-center gap-1 px-2">
                                {Array.from({ length: data.total_pages }, (_, i) => i + 1).map((p) => {
                                    // Only show first, last, and pages around current
                                    if (
                                        p === 1 ||
                                        p === data.total_pages ||
                                        (p >= page - 1 && p <= page + 1)
                                    ) {
                                        return (
                                            <Button
                                                key={p}
                                                variant={p === page ? "default" : "ghost"}
                                                size="sm"
                                                onClick={() => handlePageChange(p)}
                                                className={`w-10 h-10 rounded-xl font-bold transition-all duration-300 ${p === page
                                                    ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 dark:shadow-none scale-110"
                                                    : "text-muted-foreground hover:text-foreground"
                                                    }`}
                                            >
                                                {p}
                                            </Button>
                                        );
                                    } else if (
                                        (p === 2 && page > 3) ||
                                        (p === data.total_pages - 1 && page < data.total_pages - 2)
                                    ) {
                                        return (
                                            <span key={p} className="w-8 flex justify-center text-muted-foreground">
                                                ...
                                            </span>
                                        );
                                    }
                                    return null;
                                })}
                            </div>

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handlePageChange(page + 1)}
                                disabled={page === data.total_pages}
                                className="rounded-xl hover:bg-background h-10 w-10"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </Button>
                        </div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                            Page {page} of {data.total_pages}
                        </p>
                    </div>
                )}
            </main>

            {/* Lightbox Preview */}
            {previewIndex !== null && currentPreviewPhoto && (
                <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl flex flex-col animate-in fade-in duration-300">
                    {/* Header Area */}
                    <div className="flex items-center justify-between p-4 md:p-6 z-10">
                        <div className="text-foreground">
                            <p className="font-bold text-lg md:text-xl truncate max-w-[200px] md:max-w-md">
                                {currentPreviewPhoto.filename}
                            </p>
                            <p className="text-muted-foreground text-sm">
                                {previewIndex + 1} of {allPhotos.length}
                            </p>
                        </div>
                        <div className="flex gap-2 md:gap-4">
                            <button
                                onClick={() => handleDownload(currentPreviewPhoto.id, currentPreviewPhoto.filename)}
                                className="bg-accent/10 hover:bg-accent/20 text-foreground p-3 rounded-full transition-colors flex items-center gap-2"
                                title="Download"
                            >
                                <Download className="w-5 h-5" />
                                <span className="hidden md:inline text-sm font-semibold">Download Original</span>
                            </button>
                            <button
                                onClick={closePreview}
                                className="bg-accent/10 hover:bg-accent/20 text-foreground p-3 rounded-full transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                    </div>

                    {/* Main Image View */}
                    <div className="flex-1 relative flex items-center justify-center p-4">
                        <button
                            onClick={() => setPreviewIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))}
                            disabled={previewIndex === 0}
                            className={`absolute left-4 md:left-8 z-10 p-3 rounded-full bg-white/10 backdrop-blur-md text-black border border-white/10 transition-all hover:bg-white/20 hover:scale-110 disabled:opacity-0 disabled:cursor-default cursor-pointer shadow-2xl`}
                        >
                            <ChevronLeft className="w-8 h-8 md:w-10 md:h-10" />
                        </button>

                        <div className="relative w-full h-full ">
                            {previewLoading && (
                                <div className="absolute inset-0 flex items-center justify-center z-10">
                                    <Loader2 className="w-12 h-12 animate-spin text-muted-foreground/50" />
                                </div>
                            )}
                            <TransformWrapper
                                ref={transformComponentRef}
                                initialScale={1}
                                minScale={1}
                                maxScale={4}
                                doubleClick={{
                                    mode: "toggle",
                                    step: 2.5
                                }}
                                wheel={{
                                    step: 0.1
                                }}
                                pinch={{
                                    step: 5
                                }}
                                panning={{
                                    disabled: !isZoomed,
                                    velocityDisabled: true
                                }}
                                alignmentAnimation={{
                                    disabled: false,
                                    sizeX: 0,
                                    sizeY: 0
                                }}
                                onTransformed={(ref) => {
                                    // Track zoom state - slightly more than 1 to avoid rounding issues
                                    setIsZoomed(ref.state.scale > 1.05);
                                }}
                            >
                                <TransformComponent
                                    wrapperClass="!w-full !h-full"
                                    contentClass="!w-full !h-full flex items-center justify-center"
                                >
                                    <div
                                        className="relative w-full h-full flex items-center justify-center touch-none"
                                        onTouchStart={handleTouchStart}
                                        onTouchMove={handleTouchMove}
                                        onTouchEnd={handleTouchEnd}
                                    >
                                        <Image
                                            src={`${API_URL}${currentPreviewPhoto.preview_url}`}
                                            alt={currentPreviewPhoto.filename}
                                            fill
                                            className={`object-contain transition-all duration-500 ${previewLoading ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}
                                            unoptimized
                                            priority
                                            onLoad={() => setPreviewLoading(false)}
                                        />
                                    </div>
                                </TransformComponent>
                            </TransformWrapper>
                        </div>

                        <button
                            onClick={() => setPreviewIndex((prev) => (prev !== null && prev < allPhotos.length - 1 ? prev + 1 : prev))}
                            disabled={previewIndex === allPhotos.length - 1}
                            className={`absolute right-4 md:right-8 z-10 p-3 rounded-full bg-white/10 backdrop-blur-md text-black border border-white/10 transition-all hover:bg-white/20 hover:scale-110 disabled:opacity-0 disabled:cursor-default cursor-pointer shadow-2xl`}
                        >
                            <ChevronRight className="w-8 h-8 md:w-10 md:h-10" />
                        </button>
                    </div>

                    {/* Thumbnail Strip (Desktop) */}
                    <div className="h-24 bg-background/40 p-4 border-t border-border/5 hidden md:flex items-center justify-center gap-4 overflow-x-auto scrollbar-hide">
                        {allPhotos.map((photo, i) => (
                            <button
                                key={`${photo.id}-strip-${i}`}
                                onClick={() => setPreviewIndex(i)}
                                className={`relative h-16 aspect-[3/4] rounded-md overflow-hidden transition-all duration-300 flex-shrink-0 ${i === previewIndex ? "ring-2 ring-indigo-500 scale-110 z-10 opacity-100" : "opacity-40 hover:opacity-80"
                                    }`}
                            >
                                <Image
                                    src={`${API_URL}${photo.thumbnail_url}`}
                                    alt={photo.filename}
                                    fill
                                    className="object-cover"
                                    unoptimized
                                    sizes="80px"
                                />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <footer className="mt-16 text-center border-t border-border pt-8 pb-12">
                <p className="text-muted-foreground text-sm">
                    Sharing is caring! Tell your friends to find their photos too.
                </p>
            </footer>
        </div>
    );
}
