// Test saving tracks and recommendations directly
import { saveTracks, saveRecommendations, saveListeningHistory } from '../lib/db-sync.js';

const testUserId = '31uwbxleoppukatkwfqh'; // Your user ID from database

async function testDataSaving() {
  console.log('🧪 Testing database save operations...\n');

  try {
    // Test 1: Save a test track
    console.log('1️⃣ Testing saveTrack...');
    await saveTracks([{
      id: 'test-track-123',
      name: 'Test Song',
      artists: ['Test Artist'],
      albumName: 'Test Album',
      albumImage: 'https://example.com/image.jpg',
      externalUrl: 'https://open.spotify.com/track/test',
      genres: ['pop', 'rock']
    }]);
    console.log('✅ Track saved successfully\n');

    // Test 2: Save listening history
    console.log('2️⃣ Testing saveListeningHistory...');
    await saveListeningHistory({
      userId: testUserId,
      trackId: 'test-track-123',
      playedAt: new Date(),
    });
    console.log('✅ Listening history saved successfully\n');

    // Test 3: Save recommendations
    console.log('3️⃣ Testing saveRecommendations...');
    await saveRecommendations({
      userId: testUserId,
      recommendations: [
        {
          trackId: 'test-track-123',
          clusterScore: 0.85,
          addedReason: 'Test recommendation'
        }
      ]
    });
    console.log('✅ Recommendations saved successfully\n');

    console.log('🎉 All tests passed! Database is working correctly.\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('\nError details:', error.message);
    console.error('\nStack trace:', error.stack);
  }
}

testDataSaving();
