"use client";

import { useState, useRef } from "react";
import { signOut, useSession } from "next-auth/react";
import { redirect } from "next/navigation";

interface Track {
  id: string;
  name: string;
  artists: string[];
  albumName: string;
  albumImage: string;
  previewUrl: string | null;
  externalUrl: string;
  addedReason: string;
}

interface ProgressState {
  stage: string;
  progress: number;
  message: string;
  userTracks?: Array<{
    name: string;
    artists: string;
    albumImage: string;
  }>;
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [recommendations, setRecommendations] = useState<Track[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    stage: "",
    progress: 0,
    message: "",
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-green-500 mb-4"></div>
          <p className="text-gray-600">Loading your session...</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    redirect("/");
  }

  const fetchRecommendations = async (append: boolean = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setRecommendations([]);
    }
    setError(null);
    setPlaylistUrl(null);
    setProgress({ stage: "", progress: 0, message: "Initializing..." });

    // Close any existing EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const currentCount = append ? recommendations.length : 0;
      const eventSource = new EventSource(`/api/recommendations-stream?limit=50&offset=${currentCount}`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.stage === "complete") {
          if (append) {
            setRecommendations(prev => [...prev, ...data.recommendations]);
            setSelectedTracks(prev => {
              const newSet = new Set(prev);
              data.recommendations.forEach((t: Track) => newSet.add(t.id));
              return newSet;
            });
          } else {
            setRecommendations(data.recommendations);
            setSelectedTracks(new Set(data.recommendations.map((t: Track) => t.id)));
          }
          setLoading(false);
          setLoadingMore(false);
          setProgress({ stage: "complete", progress: 100, message: "Done!" });
          eventSource.close();
        } else if (data.stage === "error") {
          setError(data.error);
          setLoading(false);
          setLoadingMore(false);
          eventSource.close();
        } else {
          setProgress({
            stage: data.stage,
            progress: data.progress,
            message: data.message || "",
            userTracks: data.userTracks || progress.userTracks,
          });
        }
      };

      eventSource.onerror = (err) => {
        console.error("EventSource error:", err);
        setError("Connection lost. Please try again.");
        setLoading(false);
        setLoadingMore(false);
        eventSource.close();
      };
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMoreRecommendations = () => {
    fetchRecommendations(true);
  };

  const playPreview = (track: Track) => {
    if (!track.previewUrl) return;

    // Stop current playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingTrack === track.id) {
      setPlayingTrack(null);
      return;
    }

    const audio = new Audio(track.previewUrl);
    audioRef.current = audio;
    setPlayingTrack(track.id);

    audio.play();
    audio.onended = () => {
      setPlayingTrack(null);
      audioRef.current = null;
    };
  };

  const toggleTrack = (trackId: string) => {
    const newSelected = new Set(selectedTracks);
    if (newSelected.has(trackId)) {
      newSelected.delete(trackId);
    } else {
      newSelected.add(trackId);
    }
    setSelectedTracks(newSelected);
  };

  const createPlaylist = async () => {
    if (selectedTracks.size === 0) {
      setError("Please select at least one track");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/playlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `Unheard Spotipy - ${new Date().toLocaleDateString()}`,
          description: `${selectedTracks.size} personalized recommendations you haven't heard before`,
          trackIds: Array.from(selectedTracks),
          isPublic: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create playlist");
      }

      setPlaylistUrl(data.playlist.url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const exportTracks = () => {
    if (selectedTracks.size === 0) {
      setError("Please select at least one track");
      return;
    }

    const selectedTrackData = recommendations.filter(t => selectedTracks.has(t.id));
    const trackList = selectedTrackData.map((t, i) =>
      `${i + 1}. ${t.name} - ${t.artists.join(", ")}\n   ${t.externalUrl}`
    ).join("\n\n");

    const text = `Unheard Spotipy Recommendations - ${new Date().toLocaleDateString()}\n\n${trackList}`;

    navigator.clipboard.writeText(text);
    alert("Track list copied to clipboard! You can now:\n\n1. Open Spotify\n2. Create a new playlist\n3. Search for each track and add them manually\n\nOr paste the list elsewhere for reference.");
  };

  const openAllInSpotify = () => {
    if (selectedTracks.size === 0) {
      setError("Please select at least one track");
      return;
    }

    const selectedTrackData = recommendations.filter(t => selectedTracks.has(t.id));

    // Open tracks in batches of 5 to avoid overwhelming the browser
    selectedTrackData.forEach((track, index) => {
      setTimeout(() => {
        window.open(track.externalUrl, '_blank');
      }, index * 300);
    });

    alert(`Opening ${selectedTrackData.length} tracks in Spotify. You can add them to a playlist manually.`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Unheard Spotipy</h1>
            <p className="text-sm text-gray-600">Discover songs you've never heard</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Account Details */}
            {session?.user && (
              <div className="flex items-center gap-3">
                {session.user.image && (
                  <img
                    src={session.user.image}
                    alt="Profile"
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <div className="hidden sm:block text-right">
                  <p className="text-sm font-medium text-gray-900">{session.user.name}</p>
                  <p className="text-xs text-gray-500">{session.user.email}</p>
                </div>
              </div>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Generate Button */}
        {recommendations.length === 0 && !loading && (
          <div className="text-center py-12">
            <div className="mb-6">
              <div className="text-6xl mb-4">🎧</div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                Ready to Discover New Music?
              </h2>
              <p className="text-lg text-gray-600">
                We'll analyze your entire listening history and find songs you've never heard before
              </p>
            </div>
            <button
              onClick={() => fetchRecommendations(false)}
              disabled={loading}
              className="inline-flex items-center px-6 py-3 text-lg font-medium text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Generate Recommendations
            </button>
          </div>
        )}

        {/* Loading State with Progress */}
        {loading && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div className="text-center mb-6">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mb-4"></div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Analyzing Your Music Taste
                </h3>
                <p className="text-sm text-gray-500">This may take 20-40 seconds</p>
              </div>

              {/* Progress Bar */}
              <div className="mb-6">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span className="font-medium">Progress</span>
                  <span>{Math.round(progress.progress)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-green-500 h-3 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progress.progress}%` }}
                  ></div>
                </div>
              </div>

              {/* Current Stage */}
              {progress.message && (
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 capitalize">
                        {progress.stage.replace(/_/g, " ")}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">{progress.message}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* User's Listening History Preview */}
              {progress.userTracks && progress.userTracks.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                    Analyzing your music taste
                  </h4>
                  <div className="grid grid-cols-4 gap-2">
                    {progress.userTracks.map((track, idx) => (
                      <div
                        key={idx}
                        className="bg-white rounded-lg border border-gray-200 p-2 animate-fadeIn"
                        style={{ animationDelay: `${idx * 50}ms` }}
                      >
                        <img
                          src={track.albumImage || 'https://ui-avatars.com/api/?name=?&background=1DB954&color=fff&size=64'}
                          alt={track.name}
                          className="w-full aspect-square object-cover rounded mb-1.5"
                        />
                        <p className="text-xs font-medium text-gray-900 truncate">
                          {track.name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {track.artists}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Just a preview of what we're analyzing...
                  </p>
                </div>
              )}

              {/* Stage Checklist */}
              <div className="mt-6 space-y-2">
                {[
                  { key: "fetching_history", label: "Fetching listening history", threshold: 5 },
                  { key: "analyzing_features", label: "Analyzing audio features", threshold: 25 },
                  { key: "building_profile", label: "Building taste profile", threshold: 42 },
                  { key: "searching_candidates", label: "Searching global catalog", threshold: 45 },
                  { key: "scoring", label: "Scoring candidates", threshold: 65 },
                  { key: "finalizing", label: "Finalizing recommendations", threshold: 95 },
                ].map((stage) => {
                  const isActive = progress.stage === stage.key;
                  const isComplete = progress.progress > stage.threshold + 5;

                  return (
                    <div key={stage.key} className="flex items-center gap-2 text-sm">
                      {isComplete ? (
                        <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : isActive ? (
                        <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <div className="w-5 h-5 border-2 border-gray-300 rounded-full"></div>
                      )}
                      <span className={isComplete ? "text-green-600" : isActive ? "text-gray-900 font-medium" : "text-gray-500"}>
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Success State - Playlist Created */}
        {playlistUrl && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h3 className="text-xl font-semibold text-green-900 mb-2">
              Playlist Created Successfully!
            </h3>
            <p className="text-green-700 mb-4">
              Your playlist has been added to your Spotify account
            </p>
            <a
              href={playlistUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-6 py-3 text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors font-medium"
            >
              Open in Spotify
              <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        )}

        {/* Recommendations List */}
        {recommendations.length > 0 && !loading && (
          <div>
            {/* Controls */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {recommendations.length} Recommendations Found
                  </h3>
                  <p className="text-sm text-gray-600">
                    {selectedTracks.size} tracks selected
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => fetchRecommendations(false)}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={exportTracks}
                    disabled={selectedTracks.size === 0}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:bg-gray-200 disabled:cursor-not-allowed"
                    title="Copy track list to clipboard"
                  >
                    📋 Copy List
                  </button>
                  <button
                    onClick={openAllInSpotify}
                    disabled={selectedTracks.size === 0}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:bg-gray-200 disabled:cursor-not-allowed"
                    title="Open all tracks in Spotify (in new tabs)"
                  >
                    🎵 Open in Spotify
                  </button>
                  <button
                    onClick={createPlaylist}
                    disabled={creating || selectedTracks.size === 0}
                    className="px-6 py-2 text-sm font-medium text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    title="Create playlist with tracks (requires Spotify API access)"
                  >
                    {creating ? "Creating..." : "🎧 Auto-Create Playlist"}
                  </button>
                </div>
              </div>
            </div>

            {/* Track Grid - Smaller cards with 4 columns */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {recommendations.map((track) => (
                <div
                  key={track.id}
                  className={`bg-white rounded-lg shadow-sm border-2 transition-all cursor-pointer hover:shadow-md ${
                    selectedTracks.has(track.id)
                      ? "border-green-500"
                      : "border-gray-200"
                  }`}
                  onClick={() => toggleTrack(track.id)}
                >
                  <div className="p-4">
                    <div className="relative mb-3">
                      <img
                        src={track.albumImage}
                        alt={track.albumName}
                        className="w-full aspect-square object-cover rounded-lg"
                      />
                      <div className="absolute top-2 right-2">
                        <div
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                            selectedTracks.has(track.id)
                              ? "bg-green-500 border-green-500"
                              : "bg-white border-gray-300"
                          }`}
                        >
                          {selectedTracks.has(track.id) && (
                            <svg
                              className="w-4 h-4 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>
                      </div>
                    </div>

                    <h4 className="font-semibold text-gray-900 truncate mb-1">
                      {track.name}
                    </h4>
                    <p className="text-sm text-gray-600 truncate mb-2">
                      {track.artists.join(", ")}
                    </p>
                    <p className="text-xs text-gray-500 mb-3">
                      {track.addedReason}
                    </p>

                    <div className="flex flex-col gap-2">
                      {track.previewUrl && (
                        <audio
                          controls
                          className="w-full h-8"
                          src={track.previewUrl}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <a
                        href={track.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                        </svg>
                        Play in Spotify
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}