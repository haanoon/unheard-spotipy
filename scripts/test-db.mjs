// Test script to verify database connection and data
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function testDatabase() {
  try {
    console.log('🔌 Testing database connection...\n');

    // Test 1: Check if tables exist
    console.log('📋 Checking tables...');
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;

    console.log(`✅ Found ${tables.length} tables:`);
    tables.forEach(t => console.log(`   - ${t.table_name}`));
    console.log('');

    // Test 2: Count records in each table
    console.log('📊 Record counts:');
    const [users] = await sql`SELECT COUNT(*) FROM users`;
    const [tracks] = await sql`SELECT COUNT(*) FROM tracks`;
    const [listening] = await sql`SELECT COUNT(*) FROM listening_history`;
    const [interactions] = await sql`SELECT COUNT(*) FROM user_interactions`;
    const [recs] = await sql`SELECT COUNT(*) FROM recommendations`;
    const [profiles] = await sql`SELECT COUNT(*) FROM user_taste_profiles`;

    console.log(`   Users: ${users.count}`);
    console.log(`   Tracks: ${tracks.count}`);
    console.log(`   Listening History: ${listening.count}`);
    console.log(`   Interactions: ${interactions.count}`);
    console.log(`   Recommendations: ${recs.count}`);
    console.log(`   Taste Profiles: ${profiles.count}`);
    console.log('');

    // Test 3: Show sample data if exists
    if (parseInt(users.count) > 0) {
      console.log('👤 Sample Users:');
      const sampleUsers = await sql`SELECT id, email, name, created_at FROM users LIMIT 5`;
      sampleUsers.forEach(u => {
        console.log(`   - ${u.email} (ID: ${u.id.substring(0, 15)}...)`);
      });
      console.log('');
    }

    if (parseInt(tracks.count) > 0) {
      console.log('🎵 Sample Tracks:');
      const sampleTracks = await sql`
        SELECT name, artists, genres
        FROM tracks
        LIMIT 5
      `;
      sampleTracks.forEach(t => {
        const artists = Array.isArray(t.artists) ? t.artists.join(', ') : 'Unknown';
        console.log(`   - ${t.name} by ${artists}`);
      });
      console.log('');
    }

    if (parseInt(recs.count) > 0) {
      console.log('💡 Sample Recommendations:');
      const sampleRecs = await sql`
        SELECT r.added_reason, r.cluster_score, r.recommended_at, t.name
        FROM recommendations r
        JOIN tracks t ON r.track_id = t.id
        ORDER BY r.recommended_at DESC
        LIMIT 5
      `;
      sampleRecs.forEach(r => {
        console.log(`   - "${r.name}" (${r.added_reason}) at ${r.recommended_at.toISOString()}`);
      });
      console.log('');
    }

    console.log('✅ Database test complete!\n');

    if (parseInt(users.count) === 0) {
      console.log('⚠️  No data found. To populate:');
      console.log('   1. Go to http://localhost:3000');
      console.log('   2. Login with Spotify');
      console.log('   3. Generate recommendations');
      console.log('   4. Run this test again\n');
    }

  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

testDatabase();
