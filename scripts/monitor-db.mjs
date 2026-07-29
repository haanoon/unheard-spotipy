// Real-time database monitor - watch data being saved
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const sql = postgres(DATABASE_URL, { max: 1 });

let lastCounts = {
  users: 0,
  tracks: 0,
  listening: 0,
  recommendations: 0
};

async function checkDatabase() {
  try {
    const [users] = await sql`SELECT COUNT(*) FROM users`;
    const [tracks] = await sql`SELECT COUNT(*) FROM tracks`;
    const [listening] = await sql`SELECT COUNT(*) FROM listening_history`;
    const [recs] = await sql`SELECT COUNT(*) FROM recommendations`;

    const counts = {
      users: parseInt(users.count),
      tracks: parseInt(tracks.count),
      listening: parseInt(listening.count),
      recommendations: parseInt(recs.count)
    };

    // Check for changes
    let hasChanges = false;
    const changes = [];

    if (counts.users !== lastCounts.users) {
      changes.push(`Users: ${lastCounts.users} → ${counts.users}`);
      hasChanges = true;
    }
    if (counts.tracks !== lastCounts.tracks) {
      changes.push(`Tracks: ${lastCounts.tracks} → ${counts.tracks}`);
      hasChanges = true;
    }
    if (counts.listening !== lastCounts.listening) {
      changes.push(`Listening History: ${lastCounts.listening} → ${counts.listening}`);
      hasChanges = true;
    }
    if (counts.recommendations !== lastCounts.recommendations) {
      changes.push(`Recommendations: ${lastCounts.recommendations} → ${counts.recommendations}`);
      hasChanges = true;
    }

    if (hasChanges) {
      console.log(`\n[${new Date().toLocaleTimeString()}] 🔄 Database Updated:`);
      changes.forEach(c => console.log(`   ${c}`));

      // Show latest recommendation
      if (counts.recommendations > lastCounts.recommendations) {
        const latest = await sql`
          SELECT r.added_reason, r.cluster_score, t.name, t.artists
          FROM recommendations r
          JOIN tracks t ON r.track_id = t.id
          ORDER BY r.recommended_at DESC
          LIMIT 1
        `;
        if (latest.length > 0) {
          const artists = Array.isArray(latest[0].artists)
            ? latest[0].artists.join(', ')
            : 'Unknown';
          console.log(`   📀 Latest: "${latest[0].name}" by ${artists}`);
          console.log(`      ${latest[0].added_reason}`);
        }
      }
    } else {
      process.stdout.write('.');
    }

    lastCounts = counts;

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

console.log('👀 Monitoring database for changes...');
console.log('   Press Ctrl+C to stop\n');

// Initial check
checkDatabase();

// Check every 2 seconds
const interval = setInterval(checkDatabase, 2000);

// Cleanup on exit
process.on('SIGINT', async () => {
  clearInterval(interval);
  console.log('\n\n✅ Monitoring stopped');
  await sql.end();
  process.exit(0);
});
