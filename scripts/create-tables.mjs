// Script to create database tables directly
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function createTables() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL not found in environment variables');
    console.error('Make sure you have .env.local with DATABASE_URL set');
    process.exit(1);
  }

  console.log('🔌 Connecting to database...');

  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    ssl: 'require',
  });

  try {
    // Read the migration SQL file
    const migrationPath = join(__dirname, '..', 'drizzle', '0000_regular_baron_zemo.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('📄 Executing migration SQL...');

    // Split by statement-breakpoint and execute each statement
    const statements = migrationSQL
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`  Executing statement ${i + 1}/${statements.length}...`);
      await sql.unsafe(statement);
    }

    console.log('\n✅ SUCCESS! All tables created successfully:');
    console.log('   - users');
    console.log('   - tracks');
    console.log('   - listening_history');
    console.log('   - user_interactions');
    console.log('   - recommendations');
    console.log('   - user_taste_profiles');
    console.log('\n🎉 Database setup complete! You can now run: npm run dev');

  } catch (error) {
    console.error('\n❌ ERROR creating tables:', error.message);
    console.error('\nIf you see "relation already exists", the tables are already created.');
    console.error('If you see a connection error, check your DATABASE_URL in .env.local');
    process.exit(1);
  } finally {
    await sql.end();
  }
}

createTables();
