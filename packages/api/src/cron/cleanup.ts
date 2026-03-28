// Daily room cleanup — removes expired anonymous rooms at 03:00
import cron from 'node-cron';
import { rm } from 'fs/promises';
import { join } from 'path';
import { sql } from '../db/client.js';

const EXPORT_DIR = process.env['EXPORT_DIR'] ?? './data/exports';

export function startCleanupCron(): void {
  // Run daily at 03:00
  cron.schedule('0 3 * * *', async () => {
    console.log('[cleanup] Starting expired room cleanup...');
    try {
      await cleanupExpiredRooms();
    } catch (err) {
      console.error('[cleanup] Error during cleanup:', err);
    }
  });

  console.log('[cleanup] Room cleanup cron scheduled (daily 03:00)');
}

async function cleanupExpiredRooms(): Promise<void> {
  const expired = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug
    FROM rooms
    WHERE expires_at < now()
      AND is_persistent = false
      AND status = 'active'
  `;

  if (expired.length === 0) {
    console.log('[cleanup] No expired rooms found.');
    return;
  }

  console.log(`[cleanup] Found ${expired.length} expired room(s) to clean up.`);

  for (const room of expired) {
    try {
      // Delete export files from local volume
      const exportDir = join(EXPORT_DIR, room.id);
      await rm(exportDir, { recursive: true, force: true });

      // Soft-delete the room (cascades to participants, messages via FK)
      await sql`
        UPDATE rooms SET status = 'deleted' WHERE id = ${room.id}
      `;

      console.log(`[cleanup]   deleted room ${room.slug} (${room.id})`);
    } catch (err) {
      console.error(`[cleanup]   failed to delete room ${room.slug}:`, err);
    }
  }
}
