import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Home() {
  const session = await getServerSession(authOptions);

  // If user is already logged in, redirect to dashboard
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-green-50 to-blue-50">
      <div className="max-w-4xl mx-auto px-6 text-center">
        {/* Logo/Title */}
        <div className="mb-8">
          <h1 className="text-6xl font-bold text-gray-900 mb-4">
            🎵 Unheard Spotipy
          </h1>
          <p className="text-2xl text-gray-700 font-light">
            Discover Songs You've Never Heard
          </p>
        </div>

        {/* Description */}
        <div className="bg-white rounded-2xl p-8 mb-8 shadow-lg">
          <p className="text-lg text-gray-700 mb-4">
            Tired of hearing the same songs over and over? Let us analyze your Spotify listening history and find songs that match your taste but you've never heard before.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-3xl mb-2">🎧</div>
              <h3 className="font-semibold mb-1 text-gray-900">Analyze Your Taste</h3>
              <p className="text-sm text-gray-600">
                We study your listening history and audio preferences
              </p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="text-3xl mb-2">🌍</div>
              <h3 className="font-semibold mb-1 text-gray-900">Discover Any Language</h3>
              <p className="text-sm text-gray-600">
                Find music from around the world that matches your vibe
              </p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-3xl mb-2">📝</div>
              <h3 className="font-semibold mb-1 text-gray-900">Create Playlists</h3>
              <p className="text-sm text-gray-600">
                Save your discoveries directly to your Spotify account
              </p>
            </div>
          </div>
        </div>

        {/* Login Button */}
        <div className="space-y-4">
          <Link
            href="/api/auth/signin"
            className="inline-flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 text-white font-semibold px-8 py-4 rounded-full text-lg transition-all transform hover:scale-105 shadow-lg"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Login with Spotify
          </Link>
          <p className="text-sm text-gray-500">
            We'll never post anything without your permission
          </p>
        </div>

        {/* Features List */}
        <div className="mt-12 text-gray-500 text-sm">
          <p>✨ Free to use • 🔒 Secure authentication • 🚀 Instant recommendations</p>
        </div>
      </div>
    </div>
  );
}
